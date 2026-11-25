const { execSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

// Deployment configuration.
const config = {
  productionUrl: process.env.PRODUCTION_URL,
  healthPath: process.env.HEALTH_PATH || "/health.json",
  historyFile: "deployment-history.json",
  buildDirectory: "dist",
  maxRollbackAttempts: 1,
};

// Execute a command and return its output.
function runCommand(command) {
  return execSync(command, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

// Display timestamped agent messages.
function log(message) {
  console.log(`[${new Date().toISOString()}] ${message}`);
}
// Build the Expo web application.
function buildApp() {
  log("Building CampusReport for Web...");
  runCommand("npx expo export --platform web");
  log("Web build completed successfully.");
}

// Validate the generated production build.
function checkBuild() {
  log("Checking production build...");

  const requiredFiles = [
    "index.html",
    "health.json",
  ];

  for (const file of requiredFiles) {
    const filePath = path.join(config.buildDirectory, file);

    if (!fs.existsSync(filePath)) {
      throw new Error(`Required build file is missing: ${file}`);
    }
  }

  const health = JSON.parse(
    fs.readFileSync(
      path.join(config.buildDirectory, "health.json"),
      "utf8"
    )
  );

  if (
    health.status !== "ok" ||
    health.application !== "CampusReport"
  ) {
    throw new Error("Invalid health check configuration.");
  }

  log("Production build validation passed.");
}

// Identify the currently active production deployment.
function getCurrentProduction() {
  log("Identifying current production deployment...");

  const output = runCommand(
    `vercel inspect "${config.productionUrl}" --token "$VERCEL_TOKEN" 2>&1`
  );

  log(`Vercel inspect output: ${JSON.stringify(output)}`);
  const match = output.match(/\bid\s+(dpl_[A-Za-z0-9]+)/);

  if (!match) {
    throw new Error(
      "Unable to identify the current production deployment."
    );
  }

  const deploymentId = match[1];

  log(`Current production deployment: ${deploymentId}`);

  return deploymentId;
}

// Deploy a candidate version without replacing production.
function deploy() {
  log("Creating candidate deployment on Vercel...");

  const output = runCommand(
    'vercel deploy --prod --skip-domain --yes --token "$VERCEL_TOKEN"'
  );

  const deploymentUrl = output.trim().split(/\s+/).pop();

  if (!deploymentUrl || !deploymentUrl.startsWith("https://")) {
    throw new Error("Unable to identify the candidate deployment URL.");
  }

  log(`Candidate deployment: ${deploymentUrl}`);

  return deploymentUrl;
}

// Promote the validated candidate to production.
function promote(deploymentUrl) {
  log("Promoting candidate deployment to production...");

  runCommand(
    `vercel promote "${deploymentUrl}" --yes --token "$VERCEL_TOKEN"`
  );

  log("Production promotion completed.");
}

// Check whether a deployed application is accessible.
async function checkHealth(url) {
  log(`Checking deployment health: ${url}`);

  const maxAttempts = 3;
  const retryDelay = 5000;
  const baseUrl = url.replace(/\/+$/, "");
  // Authorise automated checks of protected deployments.
  const headers = {};

  if (process.env.VERCEL_AUTOMATION_BYPASS_SECRET) {
    headers["x-vercel-protection-bypass"] =
        process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
  }

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const page = await fetch(`${baseUrl}/`, {
        cache: "no-store",
        headers,
        signal: AbortSignal.timeout(15000),
      });

      const health = await fetch(
        `${baseUrl}${config.healthPath}?t=${Date.now()}`,
        {
          cache: "no-store",
          headers,
          signal: AbortSignal.timeout(15000),
        }
      );

      if (page.ok && health.ok) {
        const data = await health.json();

        if (
          data.status === "ok" &&
          data.application === "CampusReport"
        ) {
          log("Health check passed.");
          return true;
        }
      }
    } catch (error) {
      log(`Health check error: ${error.message}`);
    }

    log(`Health check attempt ${attempt}/${maxAttempts} failed.`);

    if (attempt < maxAttempts) {
      await new Promise((resolve) =>
        setTimeout(resolve, retryDelay)
      );
    }
  }

  log("Deployment health check failed.");
  return false;
}

// Restore the previous stable production deployment.
async function rollback(previousDeploymentId) {
  log("Starting automatic rollback...");

  if (!previousDeploymentId) {
    throw new Error("No previous deployment available for rollback.");
  }

  for (
    let attempt = 1;
    attempt <= config.maxRollbackAttempts;
    attempt++
  ) {
    try {
      runCommand(
        `vercel rollback "${previousDeploymentId}" --yes --token "$VERCEL_TOKEN"`
      );

      const healthy = await checkHealth(config.productionUrl);

      if (healthy) {
        log("Rollback completed successfully.");
        return true;
      }
    } catch (error) {
      log(`Rollback error: ${error.message}`);
    }
  }

  log("Automatic rollback failed.");
  return false;
}

// Record the deployment result for auditing and troubleshooting.
function recordHistory(result) {
  let history = [];

  if (fs.existsSync(config.historyFile)) {
    history = JSON.parse(
      fs.readFileSync(config.historyFile, "utf8")
    );
  }

  history.push({
    timestamp: new Date().toISOString(),
    application: "CampusReport",
    commit: process.env.GITHUB_SHA || "local",
    workflowRun: process.env.GITHUB_RUN_ID || "local",
    ...result,
  });

  fs.writeFileSync(
    config.historyFile,
    JSON.stringify(history, null, 2),
    "utf8"
  );

  log("Deployment history recorded successfully.");
}

// Execute the complete automated deployment lifecycle.
async function main() {
  const result = {
    status: "started",
    previousDeployment: null,
    candidateDeployment: null,
    previewHealth: null,
    productionHealth: null,
    rollback: "not_required",
  };

  let promotionAttempted = false;

  try {
    log("CampusReport Deployment Agent started.");

    // Validate required environment variables.
    const requiredVariables = [
      "VERCEL_TOKEN",
      "VERCEL_ORG_ID",
      "VERCEL_PROJECT_ID",
      "PRODUCTION_URL",
    ];

    for (const variable of requiredVariables) {
      if (!process.env[variable]) {
        throw new Error(`Missing environment variable: ${variable}`);
      }
    }

    // Observe: build and validate the application.
    buildApp();
    checkBuild();

    // Identify the current stable production deployment.
    result.previousDeployment = getCurrentProduction();

    // Act: deploy a candidate version.
    result.candidateDeployment = deploy();

    // Observe and decide: validate the candidate.
    result.previewHealth = await checkHealth(
      result.candidateDeployment
    );

    if (!result.previewHealth) {
      throw new Error("Candidate deployment failed health checks.");
    }

    // Act: promote the validated candidate.
    promotionAttempted = true;
    promote(result.candidateDeployment);

    // Verify the updated production environment.
    result.productionHealth = await checkHealth(
      config.productionUrl
    );

    //if (!result.productionHealth) {
    if (true) {
      throw new Error("Production deployment failed health checks.");
    }

    result.status = "success";

    log("Deployment completed successfully.");

  } catch (error) {
    result.status = "failed";
    result.error = error.message;

    log(`Deployment failed: ${error.message}`);

    // Restore production if promotion was attempted.
    if (promotionAttempted && result.previousDeployment) {
      const restored = await rollback(result.previousDeployment);

      result.rollback = restored ? "success" : "failed";
      result.status = restored ? "rolled_back" : "rollback_failed";
    }

    process.exitCode = 1;

  } finally {
    // Record the final outcome.
    recordHistory(result);
    log("Deployment Agent finished.");
  }
}

// Start the deployment agent.
main().catch((error) => {
  console.error("Unexpected agent error:", error.message);
  process.exitCode = 1;
});