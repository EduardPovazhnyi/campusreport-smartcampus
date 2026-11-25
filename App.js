import React, { useState, useEffect, useRef } from "react";
import {
  View,
  Text,
  Image,
  TextInput,
  TouchableOpacity,
  FlatList,
  StyleSheet,
  StatusBar,
  Platform,
  Modal,
  PanResponder,
  KeyboardAvoidingView,
  ActivityIndicator,
  Alert,
  useWindowDimensions,
  Keyboard,
} from "react-native";
import { MaterialIcons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Location from "expo-location";
// Respect the device's system bars and safe screen areas.
import {
  SafeAreaProvider,
  SafeAreaView,
} from "react-native-safe-area-context";
// Access the device camera and photo library.
import * as ImagePicker from "expo-image-picker";
// Select backup files for import.
import * as DocumentPicker from "expo-document-picker";

// Share and export backup files on mobile devices.
import * as Sharing from "expo-sharing";

// Access the native file system for backup operations.
import { File, Paths } from "expo-file-system";
import {
  savePhoto,
  getPhoto,
  deletePhoto,
} from "./photoStorage";


function EditableTask({ task, onSave, disabled = false }) {
  const [text, setText] = useState(task.value);
  // Validate the edited description before saving.
  const saveDescription = () => {
    if (disabled || !text.trim()) {
      setText(task.value);
      return;
    }

    const trimmedText = text.trim();

    setText(trimmedText);
    onSave(task.key, trimmedText);
  };

  return (
    <TextInput
      editable={!disabled}
      style={styles.taskText}
      value={text}
      onChangeText={setText}
      onBlur={saveDescription}
      onSubmitEditing={saveDescription}
      multiline={true}
      textAlignVertical="top"
    />
  );
}

function StoredPhoto({ photoId, onPress }) {
  const [photoUri, setPhotoUri] = useState(null);

  useEffect(() => {
    let active = true;
    let objectUrl = null;

    const loadPhoto = async () => {
      try {        
        const storedPhoto = await getPhoto(photoId);

        if (storedPhoto && active) {
          if (Platform.OS === "web") {
            // Web: convert the Blob into a display URL.
            objectUrl = URL.createObjectURL(storedPhoto);
            setPhotoUri(objectUrl);
          } else {
            // Android/iOS: use the permanent file URI.
            setPhotoUri(storedPhoto);
          }
        }
      } catch (error) {
        console.error("Error loading photo:", error);
      }
    };

    loadPhoto();

    return () => {
      active = false;
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [photoId]);

  if (!photoUri) return null;

  return (
    <TouchableOpacity
      onPress={() => onPress?.(photoUri)}
      accessibilityRole="button"
      accessibilityLabel="View report photo"
      accessibilityHint="Opens the full-screen photo gallery"
      activeOpacity={0.8}
    >
      <Image
        source={{ uri: photoUri }}
        style={styles.reportPhotoImage}
      />
    </TouchableOpacity>
  );
}

// Provide safe area information to the application.
export default function App() {
  return (
    <SafeAreaProvider>
      <CampusReport />
    </SafeAreaProvider>
  );
}

// Convert a stored photo into Base64 for portable backups.
const photoToBase64 = async (photoId) => {
  const storedPhoto = await getPhoto(photoId);

  if (!storedPhoto) {
    throw new Error("Stored photo not found.");
  }

  if (Platform.OS === "web") {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();

      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);

      reader.readAsDataURL(storedPhoto);
    });
  }

  const file = new File(storedPhoto);
  const base64 = await file.base64();

  return `data:image/jpeg;base64,${base64}`;
};

// Restore a photo from a portable Base64 backup.
const restorePhotoFromBase64 = async (dataUrl) => {
  if (
    typeof dataUrl !== "string" ||
    !/^data:image\/[\w.+-]+;base64,/.test(dataUrl)
  ) {
    throw new Error("Invalid backup photo format.");
  }

  if (Platform.OS === "web") {
    // Restore the photo into IndexedDB.
    const response = await fetch(dataUrl);
    const blob = await response.blob();

    return await savePhoto(blob);
  }

  // Restore the photo into native private storage.
  const base64 = dataUrl.split(",")[1];

  const tempFile = new File(
    Paths.cache,
    `restore-${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`
  );

  try {
    tempFile.create();
    tempFile.write(base64, { encoding: "base64" });

    return await savePhoto(tempFile.uri);
  } finally {
    if (tempFile.exists) {
      tempFile.delete();
    }
  }
};

function CampusReport() {
  // Detect screen width for responsive dashboard layout.
  const { width } = useWindowDimensions();
  const isWideScreen = width >= 768;
  // Store the tasks in React state.
  const [tasks, setTasks] = useState([]);
  const [input, setInput] = useState("");
  // Track the visibility of the device keyboard.
  const [keyboardVisible, setKeyboardVisible] = useState(false);

  useEffect(() => {
    const showSubscription = Keyboard.addListener(
      "keyboardDidShow",
      () => setKeyboardVisible(true)
    );

    const hideSubscription = Keyboard.addListener(
      "keyboardDidHide",
      () => setKeyboardVisible(false)
    );

    return () => {
      showSubscription.remove();
      hideSubscription.remove();
    };
  }, []);

  // Store up to 10 photos for a new campus report.
  const [reportPhotos, setReportPhotos] = useState([]);
  // Control the full-screen photo viewer.
  const [selectedPhoto, setSelectedPhoto] = useState(null);
  // Store the photos available in the current gallery.
  const [galleryPhotos, setGalleryPhotos] = useState([]);

  // Track the currently displayed photo.
  const [galleryIndex, setGalleryIndex] = useState(0);
  // Open the photo gallery at the selected image.
  const openPhotoGallery = async (photoIds, startIndex) => {
    const photos = [];

    for (const photoId of photoIds) {
      const storedPhoto = await getPhoto(photoId);

      if (storedPhoto) {
        const uri = Platform.OS === "web"
          ? URL.createObjectURL(storedPhoto)
          : storedPhoto;

        photos.push(uri);
      } else {
        photos.push(null);
      }
    }

    setGalleryPhotos(photos);
    setGalleryIndex(startIndex);
    setSelectedPhoto(photos[startIndex]);
  };
  // Navigate between photos in the current gallery.
  const navigatePhoto = (direction) => {
    const nextIndex = galleryIndex + direction;

    if (nextIndex >= 0 && nextIndex < galleryPhotos.length) {
      setGalleryIndex(nextIndex);
      setSelectedPhoto(galleryPhotos[nextIndex]);
    }
  };
  // Detect horizontal swipe gestures in the photo gallery.
  const gallerySwipe = PanResponder.create({
    onStartShouldSetPanResponder: () => true,

    onPanResponderRelease: (_, gestureState) => {
      if (
        Math.abs(gestureState.dx) >
        Math.abs(gestureState.dy)
      ) {
        if (gestureState.dx < -50) {
          navigatePhoto(1);
        } else if (gestureState.dx > 50) {
          navigatePhoto(-1);
        }
      }
    },
  });
  // Control the photo source selection menu.
  const [photoMenuVisible, setPhotoMenuVisible] = useState(false); //menu open state
  // Control the visibility of the backup management menu.
  const [backupMenuVisible, setBackupMenuVisible] = useState(false);
  // Track whether a backup operation is currently running.
  const [backupInProgress, setBackupInProgress] = useState(false);
  // Prevent overlapping data modification and backup operations.
  const operationLock = useRef(false);

  // Open the device camera to photograph a campus issue.
  const takePhoto = async () => {
      if (reportPhotos.length >= 10) {
        alert("Maximum 10 photos per report.");
        return;
      }
    try {
      const permission =
        await ImagePicker.requestCameraPermissionsAsync();

      if (!permission.granted) {
        alert("Camera permission is required to take a photo.");
        return;
      }

      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ["images"],
        allowsEditing: false,
        quality: 0.6,
        base64: true,
      });

      
      if (!result.canceled && result.assets?.length > 0) {        
        const photo = result.assets[0];

        // Convert the selected image into a Blob.        
        let photoId;

        if (Platform.OS === "web") {
          // Save the actual image in IndexedDB.
          // Web: save the image Blob in IndexedDB.
          const response = await fetch(photo.uri);
          const photoBlob = await response.blob();

          photoId = await savePhoto(photoBlob);
        } else {
          // Android/iOS: save the image in the app's directory.
          photoId = await savePhoto(photo.uri);
        }

        // Keep the ID and preview URI together.        
        const previewUri =
          Platform.OS === "web"
            ? photo.uri
            : await getPhoto(photoId);

        setReportPhotos((previousPhotos) => [
          ...previousPhotos,
          {
            id: photoId,
            uri: previewUri,
          },
        ]);
      }
    } catch (error) {
      console.error("Camera error:", error);
      alert("Unable to open the camera.");
    }
  };


// Select multiple photos from the device gallery.
const pickPhotoFromGallery = async () => {
  const remainingSlots = 10 - reportPhotos.length;

  if (remainingSlots <= 0) {
    alert("Maximum 10 photos per report.");
    return;
  }

  try {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsEditing: false,
      allowsMultipleSelection: true,
      selectionLimit: remainingSlots,
      quality: 0.6,
      base64: false,
    });

    if (result.canceled || !result.assets?.length) {
      return;
    }

    // Respect the remaining photo limit on all platforms.
    const selectedPhotos = result.assets.slice(0, remainingSlots);

    for (const photo of selectedPhotos) {
      let photoId;

      if (Platform.OS === "web") {
        // Web: store the image Blob in IndexedDB.
        const response = await fetch(photo.uri);
        const photoBlob = await response.blob();

        photoId = await savePhoto(photoBlob);
      } else {
        // Android/iOS: store a private copy of the image.
        photoId = await savePhoto(photo.uri);
      }

      const previewUri =
        Platform.OS === "web"
          ? photo.uri
          : await getPhoto(photoId);

      setReportPhotos((previousPhotos) => [
        ...previousPhotos,
        {
          id: photoId,
          uri: previewUri,
        },
      ]);
    }
  } catch (error) {
    console.error("Gallery error:", error);
    alert("Unable to import photos from the gallery.");
  }
};


  const [storageLoaded, setStorageLoaded] = useState(false);
  // Available campus issue categories.
  const categories = [
    "IT & Wi-Fi",
    "Facilities",
    "Outdoor & Grounds",
    "Cleanliness",
    "Safety",
  ];

  // Require the user to explicitly select an issue category.
  const [category, setCategory] = useState(null);
  // Currently selected report filter.
  const [statusFilter, setStatusFilter] = useState("All");
  // Search text for campus reports.
  const [searchQuery, setSearchQuery] = useState("");
  // Currently selected report sorting order.
  const [sortOrder, setSortOrder] = useState("Newest");
  // Control the visibility of the dashboard.
  const [dashboardExpanded, setDashboardExpanded] = useState(true);

  // Control the visibility of report filtering and sorting options.
  const [filtersExpanded, setFiltersExpanded] = useState(true);

  // Load previously saved tasks when the app starts.
useEffect(() => {
  const loadTasks = async () => {
    try {
      const savedTasks = await AsyncStorage.getItem("campusReports");

      if (savedTasks !== null) {
        setTasks(JSON.parse(savedTasks));
      }
    } catch (error) {
      console.error("Error loading tasks:", error);
    } finally {
      setStorageLoaded(true);
    }
  };

  loadTasks();
}, []);

// Save tasks whenever the task list changes.
useEffect(() => {
  if (!storageLoaded) return;

  const saveTasks = async () => {
    try {
      await AsyncStorage.setItem("campusReports", JSON.stringify(tasks));
    } catch (error) {
      console.error("Error saving tasks:", error);
    }
  };

  saveTasks();
}, [tasks, storageLoaded]);

// Import campus reports and restore their associated photos.
const importBackup = async () => {
  if (operationLock.current || !storageLoaded) return;

  operationLock.current = true;
  setBackupInProgress(true);

  const restoredPhotoIds = [];

  try {
    const result = await DocumentPicker.getDocumentAsync({
      type: "application/json",
      copyToCacheDirectory: true,
      multiple: false,
    });

    if (result.canceled) return;

    const asset = result.assets[0];

    let json;

    if (Platform.OS === "web") {
      const response = await fetch(asset.uri);
      json = await response.text();
    } else {
      const file = new File(asset.uri);
      json = await file.text();
    }

    const backup = JSON.parse(json);

    // Validate the backup format and version.
    if (
      !backup ||
      backup.application !== "CampusReport" ||
      backup.version !== 1 ||
      !Array.isArray(backup.reports)
    ) {
      throw new Error("Invalid or unsupported backup file.");
    }

    // Validate all reports before restoring any photos.
    for (const report of backup.reports) {
      if (
        !report ||
        typeof report.key !== "string" ||
        !report.key.trim() ||
        typeof report.value !== "string" ||
        !report.value.trim() ||
        !categories.includes(report.category) ||
        !["Submitted", "In Progress", "Resolved"].includes(report.status) ||
        !["Low", "Medium", "High"].includes(report.priority) ||
        typeof report.createdAt !== "string" ||
        !Number.isFinite(Date.parse(report.createdAt)) ||
        (report.location != null &&
          (
            typeof report.location !== "object" ||
            !Number.isFinite(report.location.latitude) ||
            !Number.isFinite(report.location.longitude) ||
            Math.abs(report.location.latitude) > 90 ||
            Math.abs(report.location.longitude) > 180 ||
            typeof report.location.city !== "string"
          )
        ) ||
        !Array.isArray(report.photos) ||
        report.photos.length > 10 ||
        !report.photos.every(
          (photo) =>
            typeof photo === "string" &&
            /^data:image\/(jpeg|jpg|png|webp|gif|heic|heif|avif);base64,[A-Za-z0-9+/]+={0,2}$/i.test(photo) &&
            photo.split(",")[1].length % 4 === 0
        )
      ) {
        throw new Error("Invalid report data in backup.");
      }
    }

    const existingKeys = new Set(
      tasks.map((task) => task.key)
    );

    const importedReports = [];

    let skippedReports = 0;

    for (const report of backup.reports) {
      // Prevent duplicate reports.
      if (existingKeys.has(report.key)) {
        skippedReports++;
        continue;
      }

      const photos = [];

      for (const base64 of report.photos) {
        const photoId = await restorePhotoFromBase64(base64);

        restoredPhotoIds.push(photoId);
        photos.push(photoId);
      }

      importedReports.push({
        ...report,
        photos,
      });

      existingKeys.add(report.key);
    }

    // Merge imported reports with existing reports.
    const mergedReports = [...importedReports, ...tasks];

    // Persist the imported reports before confirming success.
    await AsyncStorage.setItem(
      "campusReports",
      JSON.stringify(mergedReports)
    );

    // Update the application state.
    setTasks(mergedReports);

    alert(
      `Backup imported successfully.\n\n` +
      `Imported reports: ${importedReports.length}\n` +
      `Skipped duplicates: ${skippedReports}`
    );
  } catch (error) {
    // Remove partially restored photos if import fails.
    for (const photoId of restoredPhotoIds) {
      try {
        await deletePhoto(photoId);
      } catch (cleanupError) {
        console.error("Photo cleanup failed:", cleanupError);
      }
    }

        console.error("Backup import failed:", error);
    alert("Unable to import the backup. Please check the file.");
  } finally {
    operationLock.current = false;
    setBackupInProgress(false);
  }
};

// Export all campus reports and photos as a portable JSON backup.
const exportBackup = async () => {
  if (operationLock.current || !storageLoaded) return;

  operationLock.current = true;
  setBackupInProgress(true);

  try {
    const backupReports = [];

    for (const task of tasks) {
      const photos = [];

      for (const photoId of task.photos || []) {
        const base64 = await photoToBase64(photoId);
        photos.push(base64);
      }

      backupReports.push({
        ...task,
        photos,
      });
    }

    const backup = {
      application: "CampusReport",
      version: 1,
      exportedAt: new Date().toISOString(),
      reports: backupReports,
    };

    const json = JSON.stringify(backup, null, 2);

    const fileName =
      `campus-report-backup-${new Date().toISOString().slice(0, 10)}.json`;

    if (Platform.OS === "web") {
      // Download the backup through the browser.
      const blob = new Blob([json], {
        type: "application/json",
      });

      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");

      link.href = url;
      link.download = fileName;

      document.body.appendChild(link);
      link.click();
      link.remove();

      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } else {
      // Create and share the backup on mobile devices.
      if (!(await Sharing.isAvailableAsync())) {
        throw new Error("File sharing is unavailable.");
      }

      const file = new File(Paths.cache, fileName);

      file.create({ overwrite: true });
      file.write(json);

      await Sharing.shareAsync(file.uri, {
        mimeType: "application/json",
        dialogTitle: "Export Campus Report Backup",
      });
    }
    } catch (error) {
    console.error("Backup export failed:", error);
    alert("Unable to export the backup.");
  } finally {
    operationLock.current = false;
    setBackupInProgress(false);
  }
};

// Get the device's current location and city name.
const getLocation = async () => {
  try {
    const { status } = await Location.requestForegroundPermissionsAsync();

    if (status !== "granted") {
      console.warn("Location permission denied");
      return null;
    }

    const location = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    });

    const { latitude, longitude } = location.coords;

    // Convert GPS coordinates into a readable place name.
    // Convert GPS coordinates into a readable city name.
    let city = "Unknown location";
    // Use native reverse geocoding on Android and iOS.
    if (Platform.OS !== "web") {
      try {
        const addresses = await Location.reverseGeocodeAsync({
          latitude,
          longitude,
        });

        if (addresses.length > 0) {
          const address = addresses[0];
          // Extract the town from a formatted UK address.
          const formattedTown =
            address.isoCountryCode === "GB" &&
            address.formattedAddress &&
            address.postalCode
              ? address.formattedAddress
                  .split(address.postalCode)[0]
                  .split(",")
                  .pop()
                  .trim()
              : null;

          city =
            address.city ||
            formattedTown ||
            address.district ||
            address.subregion ||
            address.region ||
            "Unknown location";
        }

        if (city !== "Unknown location") {
          return { latitude, longitude, city };
        }
      } catch (error) {
        console.warn("Native reverse geocoding failed:", error);
      }
    }

    try {
      const url =
        `https://nominatim.openstreetmap.org/reverse` +
        `?format=jsonv2&lat=${latitude}&lon=${longitude}` +
        `&zoom=14&addressdetails=1`;

      const response = await fetch(url, {
        headers: {
          Accept: "application/json",
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();
      const address = data.address || {};

      city =
        address.city ||
        address.town ||
        address.village ||
        address.municipality ||
        address.county ||
        "Unknown location";

    } catch (error) {
      console.warn("Reverse geocoding failed:", error);
    }

    return {
      latitude,
      longitude,
      city,
    };
  } catch (error) {
    console.error("Error getting location:", error);
    return null;
  }
};

  // Add a new task with its current GPS location.
  const addTask = async () => {
    // Prevent overlapping data operations.
    if (operationLock.current || !storageLoaded) return;
    if (!input.trim()) return;
    // Prevent report submission without a selected category.
    if (!category) {
      alert("Please select an issue category before submitting your report.");
      return;
    }

    operationLock.current = true;

    try {
      const taskText = input.trim();

      // Get the device location.
      const location = await getLocation();

      const newTask = {
        key: Date.now().toString(),
        value: taskText,
        category: category,
        priority: "Medium",
        status: "Submitted",
        location: location,
        createdAt: new Date().toISOString(),
        photos: reportPhotos.map((photo) => photo.id),
      };

      setTasks((previousTasks) => [newTask, ...previousTasks]);
      setInput("");
      // Reset the category for the next report.
      setCategory(null);
      setReportPhotos([]);
    } catch (error) {
      console.error("Error creating report:", error);
      alert("Unable to create the report.");
    } finally {
      operationLock.current = false;
    }
  };



  // Move a campus report to the next status.
  const changeStatus = (key) => {
    // Prevent overlapping data operations.
    if (operationLock.current || !storageLoaded) return;
    setTasks((previousTasks) =>
      previousTasks.map((task) => {
        if (task.key !== key) return task;

        const currentStatus = task.status || "Submitted";

        const nextStatus =
          currentStatus === "Submitted"
            ? "In Progress"
            : currentStatus === "In Progress"
            ? "Resolved"
            : "Submitted";

        return { ...task, status: nextStatus };
      })
    );
  };

  // Change the priority of a campus report.
  const changePriority = (key) => {
    // Prevent overlapping data operations.
    if (operationLock.current || !storageLoaded) return;
    setTasks((previousTasks) =>
      previousTasks.map((task) => {
        if (task.key !== key) return task;

        const currentPriority = task.priority || "Medium";

        const nextPriority =
          currentPriority === "Medium"
            ? "High"
            : currentPriority === "High"
            ? "Low"
            : "Medium";

        return { ...task, priority: nextPriority };
      })
    );
  };

  // Request confirmation before deleting a report.
  const confirmDeleteTask = (key) => {
    const message =
      "Are you sure you want to delete this report and all its attached photos?";

    if (Platform.OS === "web") {
      if (window.confirm(message)) {
        deleteTask(key);
      }
    } else {
      Alert.alert("Delete report?", message, [
        {
          text: "Cancel",
          style: "cancel",
        },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => deleteTask(key),
        },
      ]);
    }
  };

  // Remove a task using its unique key.
  const deleteTask = async (key) => {
    // Prevent overlapping data operations.
    if (operationLock.current || !storageLoaded) return;

    const taskToDelete = tasks.find((task) => task.key === key);

    if (!taskToDelete) return;

    operationLock.current = true;

    try {
      // Delete all photos belonging to this report.
      for (const photoId of taskToDelete.photos || []) {
        await deletePhoto(photoId);
      }

      // Remove the report after deleting its photos.
      setTasks((previousTasks) =>
        previousTasks.filter((task) => task.key !== key)
      );
    } catch (error) {
      console.error("Error deleting report:", error);
      alert("Unable to delete the report.");
    } finally {
      operationLock.current = false;
    }
  };


    // Calculate campus report statistics.
  const reportStats = {
    total: tasks.length,

    submitted: tasks.filter(
      (task) => (task.status || "Submitted") === "Submitted"
    ).length,

    inProgress: tasks.filter(
      (task) => task.status === "In Progress"
    ).length,

    resolved: tasks.filter(
      (task) => task.status === "Resolved"
    ).length,
  };

  // Show only reports matching the selected status.
  
  const filteredTasks = tasks.filter((task) => {
    // Check the selected status.
    const matchesStatus =
      statusFilter === "All" ||
      (task.status || "Submitted") === statusFilter;

    // Check the report description and category.
    const query = searchQuery.trim().toLowerCase();

    const matchesSearch =
      (task.value || "").toLowerCase().includes(query) ||
      (task.category || "").toLowerCase().includes(query);

    return matchesStatus && matchesSearch;
  });


  
    // Sort the filtered campus reports.
    const sortedTasks = [...filteredTasks].sort((a, b) => {
      if (sortOrder === "Priority") {
        const priorityValues = {
          High: 3,
          Medium: 2,
          Low: 1,
        };

        return (
          (priorityValues[b.priority] || 2) -
          (priorityValues[a.priority] || 2)
        );
      }

      const dateA = new Date(a.createdAt || 0).getTime();
      const dateB = new Date(b.createdAt || 0).getTime();

      return sortOrder === "Oldest"
        ? dateA - dateB
        : dateB - dateA;
    });



  // Update the text of an existing task.
  const editTask = (key, newValue) => {
    // Prevent overlapping data operations.
    if (operationLock.current || !storageLoaded) return;
    // Prevent saving an empty report description.
    if (!newValue.trim()) return;

    setTasks((previousTasks) =>
      previousTasks.map((task) =>
        task.key === key
          ? { ...task, value: newValue.trim() }
          : task
      )
    );
  };

  return (
    <SafeAreaView
      style={[
        styles.container,
        Platform.OS === "android" && { marginBottom: -8 },
      ]}
    >
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "web" ? undefined : "padding"}
        enabled={Platform.OS === "ios" || (Platform.OS === "android" && keyboardVisible)}
      >
      <StatusBar barStyle="light-content" backgroundColor="midnightblue" />

      <View style={styles.header}>
        <View>
          <Text style={styles.campusLabel}>UWS PAISLEY CAMPUS</Text>
          <Text style={styles.title}>Campus Report</Text>
          <Text style={styles.subtitle}>
            Report an issue. Improve our campus.
          </Text>
        </View>
        {/* Open the backup management menu */}
        <TouchableOpacity
          style={styles.moreOptionsButton}
          onPress={() => setBackupMenuVisible(true)}
          disabled={backupInProgress || !storageLoaded}
          accessibilityRole="button"
          accessibilityLabel="More options"
          accessibilityHint="Opens backup management options"
          accessibilityState={{
            disabled: backupInProgress || !storageLoaded,
            busy: backupInProgress,
          }}
        >
          {backupInProgress ? (
            <ActivityIndicator
              size="small"
              color="#FFFFFF"
            />
          ) : (
            <MaterialIcons
              name="more-vert"
              size={28}
              color="#FFFFFF"
            />
          )}
        </TouchableOpacity>
      </View>

      <FlatList
        style={styles.list}
        data={sortedTasks}
        ListHeaderComponent={
          <View>
          {/* Campus report statistics dashboard */} 
    <View style={styles.dashboardSection}>
      {/* Expand or collapse the dashboard. */}
      <TouchableOpacity
        style={styles.collapsibleHeader}
        onPress={() => setDashboardExpanded((previous) => !previous)}
        accessibilityRole="button"
        accessibilityLabel="Campus report dashboard"
        accessibilityState={{ expanded: dashboardExpanded }}
      >
        <Text style={styles.categoryTitle}>
          CAMPUS REPORT DASHBOARD
        </Text>

        <MaterialIcons
          name={dashboardExpanded ? "expand-less" : "expand-more"}
          size={26}
          color="#FFFFFF"
        />
      </TouchableOpacity>

      {dashboardExpanded && (
        <View style={styles.dashboardGrid}>
        {[
          {
            label: "Total Reports",
            value: reportStats.total,
            background: "#FFFFFF",
            color: "#183B80",
          },
          {
            label: "Submitted",
            value: reportStats.submitted,
            background: "#DBEAFE",
            color: "#1E40AF",
          },
          {
            label: "In Progress",
            value: reportStats.inProgress,
            background: "#FEF3C7",
            color: "#92400E",
          },
          {
            label: "Resolved",
            value: reportStats.resolved,
            background: "#D1FAE5",
            color: "#065F46",
          },
        ].map((stat) => (
          <View
            key={stat.label}
            style={[
              styles.dashboardCard,
              {
                backgroundColor: stat.background,
                width: isWideScreen ? "24%" : "48%",
              },
            ]}
          >
            <Text style={[styles.dashboardLabel, { color: stat.color }]}>
              {stat.label}
            </Text>

            <Text style={[styles.dashboardValue, { color: stat.color }]}>
              {stat.value}
            </Text>
          </View>
        ))}
      </View>
      )}
      {/* Expand or collapse report filtering options. */}
      <TouchableOpacity
        style={styles.collapsibleHeader}
        onPress={() => setFiltersExpanded((previous) => !previous)}
        accessibilityRole="button"
        accessibilityLabel="Filter and sort reports"
        accessibilityState={{ expanded: filtersExpanded }}
      >
        <Text style={styles.categoryTitle}>
          FILTER & SORT REPORTS
        </Text>

        <MaterialIcons
          name={filtersExpanded ? "expand-less" : "expand-more"}
          size={26}
          color="#FFFFFF"
        />
      </TouchableOpacity>
      {/* Filter campus reports by status */} 
      {filtersExpanded && (
        <>
        <View style={styles.filterSection}>
          <Text style={styles.categoryTitle}>FILTER BY STATUS</Text>

          <View style={styles.categoryContainer}>
            {["All", "Submitted", "In Progress", "Resolved"].map((status) => (
              <TouchableOpacity
                key={status}
                style={[
                  styles.categoryButton,
                  statusFilter === status && styles.categorySelected,
                ]}
                onPress={() => setStatusFilter(status)}
                accessibilityRole="button"
                accessibilityLabel={`Filter by ${status}`}
                accessibilityState={{ selected: statusFilter === status }}
              >
                <Text
                  style={[
                    styles.categoryButtonText,
                    statusFilter === status && styles.categorySelectedText,
                  ]}
                >
                  {status}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
       {/* Search campus reports */} 
      <View style={styles.searchSection}>
        <MaterialIcons
          name="search"
          size={22}
          color="#64748B"
        />

        <TextInput
          style={styles.searchInput}
          placeholder="Search reports..."
          placeholderTextColor="#64748B"
          value={searchQuery}
          onChangeText={setSearchQuery}
        />

        {searchQuery.length > 0 && (
          <TouchableOpacity onPress={() => setSearchQuery("")}>
            <MaterialIcons
              name="close"
              size={20}
              color="#64748B"
            />
          </TouchableOpacity>
        )}
      </View>

      {/* Sort campus reports */} 
      <View style={styles.sortSection}>
        <Text style={styles.categoryTitle}>SORT REPORTS BY</Text>

        <View style={styles.categoryContainer}>
          {["Newest", "Oldest", "Priority"].map((option) => (
            <TouchableOpacity
              key={option}
              style={[
                styles.categoryButton,
                sortOrder === option && styles.categorySelected,
              ]}
              onPress={() => setSortOrder(option)}
              accessibilityRole="button"
              accessibilityLabel={`Sort by ${option}`}
              accessibilityState={{ selected: sortOrder === option }}
            >
              <Text
                style={[
                  styles.categoryButtonText,
                  sortOrder === option && styles.categorySelectedText,
                ]}
              >
                {option}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>
      </>
      )}
    </View>
    {/* Number of reports matching the selected filter */} 
      <View style={styles.reportCountRow}>
        <Text style={styles.reportCountText}>
          Campus reports
        </Text>

        <Text style={styles.reportCountBadge}>
          {filteredTasks.length} reports
        </Text>
      </View>


          </View>
        }
        keyExtractor={(item) => item.key}

        ListEmptyComponent={
          <Text style={styles.emptyText}>
            {statusFilter === "All"
              ? "No campus reports yet.\nBe the first to report an issue!"
              : `No ${statusFilter.toLowerCase()} reports found.`}
          </Text>
        }


  
        renderItem={({ item }) => (
          <View style={styles.task}>
            <MaterialIcons name="report-problem" size={24} color="#E6A800" />

            <View style={styles.taskContent}>
              <EditableTask disabled={backupInProgress || !storageLoaded} task={item} onSave={editTask} />

            {/* Display photos attached to this campus report */} 
            {item.photos?.length > 0 && (
              <View style={styles.reportPhotosSection}>
                <Text style={styles.reportPhotosLabel}>
                  Photos ({item.photos.length})
                </Text>

                <View style={styles.reportPhotosGrid}>
                  {item.photos.map((photo, index) => (                    
                    <StoredPhoto
                      key={`${item.key}-${index}`}
                      photoId={photo}
                      onPress={() => openPhotoGallery(item.photos, index)}
                    />
                  ))}
                </View>
              </View>
            )}

              {/* Issue category and report status */} 
              <View style={styles.badgeRow}>
                <View style={styles.categoryBadge}>
                  <Text style={styles.categoryBadgeText}>
                    {item.category || "General"}
                  </Text>
                </View>

                <TouchableOpacity
                  style={[
                    styles.statusBadge,
                    {
                      backgroundColor:
                        item.status === "Resolved"
                          ? "#D1FAE5"
                          : item.status === "In Progress"
                          ? "#FEF3C7"
                          : "#DBEAFE",
                    },
                  ]}
                  onPress={() => changeStatus(item.key)}
                  accessibilityRole="button"
                  accessibilityLabel={`Report status: ${item.status || "Submitted"}`}
                  accessibilityHint="Changes the report status"
                  disabled={backupInProgress || !storageLoaded}
                >
                  <Text
                    style={[
                      styles.statusBadgeText,
                      {
                        color:
                          item.status === "Resolved"
                            ? "#065F46"
                            : item.status === "In Progress"
                            ? "#92400E"
                            : "#1E40AF",
                      },
                    ]}
                  >
                    {item.status || "Submitted"}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => changePriority(item.key)}
                  accessibilityRole="button"
                  accessibilityLabel={`Report priority: ${item.priority || "Medium"}`}
                  accessibilityHint="Changes the report priority"
                  disabled={backupInProgress || !storageLoaded}
                  style={[
                    styles.statusBadge,
                    {
                      backgroundColor:
                        item.priority === "High"
                          ? "#FEE2E2"
                          : item.priority === "Low"
                          ? "#D1FAE5"
                          : "#FEF3C7",
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.statusBadgeText,
                      {
                        color:
                          item.priority === "High"
                            ? "#991B1B"
                            : item.priority === "Low"
                            ? "#065F46"
                            : "#92400E",
                      },
                    ]}
                  >
                    {item.priority || "Medium"}
                  </Text>
                </TouchableOpacity>
                </View>

             <Text style={styles.locationText}>
                {item.location
                  ? `📍 ${item.location.city || "Location"} (${item.location.latitude.toFixed(5)}, ${item. location.longitude.toFixed(5)})`
                  : "📍 Location not available"}
              </Text>
              {item.createdAt && (
                <Text style={styles.locationText}>
                  🕒 {new Date(item.createdAt).toLocaleString("en-GB")}
                </Text>
              )}
            </View>

            <TouchableOpacity
              onPress={() => confirmDeleteTask(item.key)}
              accessibilityRole="button"
              accessibilityLabel="Delete campus report"
              disabled={backupInProgress || !storageLoaded}
            >
              <MaterialIcons name="delete" size={26} color="midnightblue" />
            </TouchableOpacity>
          </View>
        )}
      />

      {/* Campus issue category selector */} 
      <View style={styles.categorySection}>
        <Text style={styles.categoryTitle}>
          SELECT ISSUE CATEGORY
        </Text>

      <View style={styles.categoryContainer}>
        {categories.map((item) => (
          <TouchableOpacity
            key={item}
            style={[
              styles.categoryButton,
              category === item && styles.categorySelected,
            ]}
            onPress={() => setCategory(item)}
            accessibilityRole="button"
            accessibilityLabel={`Select category ${item}`}
            accessibilityState={{ selected: category === item }}
          >
              <Text
                style={[
                  styles.categoryButtonText,
                  category === item && styles.categorySelectedText,
                ]}
              >
                {item}
              </Text>
              </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* Preview photos before submitting a report */} 
      {reportPhotos.length > 0 && (
        <View>
          <Text style={{ color: "#FFFFFF", marginBottom: 8 }}>
            Photos: {reportPhotos.length}/10
          </Text>

          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {reportPhotos.map((photo, index) => (
              <View key={photo.id} style={styles.photoPreview}>                
                <TouchableOpacity
                  activeOpacity={0.8}
                  onPress={() =>
                    openPhotoGallery(
                      reportPhotos.map((item) => item.id),
                      index
                    )
                  }
                >
                  <Image
                    source={{ uri: photo.uri }}
                    style={styles.photoPreviewImage}
                  />
                </TouchableOpacity>

                <TouchableOpacity                  
                  onPress={async () => {
                    try {
                      await deletePhoto(photo.id);

                      setReportPhotos((previousPhotos) =>
                        previousPhotos.filter(
                          (item) => item.id !== photo.id
                        )
                      );
                    } catch (error) {
                      console.error("Error deleting photo:", error);
                      alert("Unable to delete photo.");
                    }
                  }}
                >
                  <MaterialIcons
                    name="cancel"
                    size={24}
                    color="#DC2626"
                  />
                </TouchableOpacity>
              </View>
            ))}
          </View>
        </View>
      )}
      <View style={styles.inputRow}>
        <TextInput
          style={styles.input}
         placeholder="Describe a campus issue..."
         accessibilityLabel="Campus issue description"
         editable={!backupInProgress && storageLoaded}
          value={input}
          onChangeText={setInput}
          onSubmitEditing={addTask}
        />


        


        {/* Take a photo of the campus issue */} 
        <TouchableOpacity
          style={[
            styles.cameraButton,
            (backupInProgress || !storageLoaded) && { opacity: 0.5 },
          ]}
          disabled={backupInProgress || !storageLoaded}
          onPress={() => setPhotoMenuVisible(true)}
          accessibilityRole="button"
          accessibilityLabel="Add photos"
          accessibilityHint="Opens camera and gallery options"
        >
          <MaterialIcons
            name="photo-camera"
            size={26}
            color="#183B80"
          />
        {/* Photo source selection menu */}
        <Modal
          visible={photoMenuVisible}
          transparent={true}
          animationType="fade"
          onRequestClose={() => setPhotoMenuVisible(false)}
        >
          <View style={styles.photoMenuOverlay}>
            <View style={styles.photoMenuContainer}>

              <Text style={styles.photoMenuTitle}>
                Add photos
              </Text>

              <Text style={styles.photoMenuSubtitle}>
                Choose a photo source
              </Text>

              <TouchableOpacity
                style={styles.photoMenuOption}
                onPress={() => {
                  setPhotoMenuVisible(false);
                  takePhoto();
                }}
              >
                <View style={styles.photoMenuIcon}>
                  <MaterialIcons
                    name="photo-camera"
                    size={24}
                    color="#173B75"
                  />
                </View>

                <View style={styles.photoMenuOptionText}>
                  <Text style={styles.photoMenuOptionTitle}>
                    Take a photo
                  </Text>
                  <Text style={styles.photoMenuOptionSubtitle}>
                    Use your device camera
                  </Text>
                </View>

                <MaterialIcons
                  name="chevron-right"
                  size={24}
                  color="#64748B"
                />
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.photoMenuOption}
                onPress={() => {
                  setPhotoMenuVisible(false);
                  pickPhotoFromGallery();
                }}
              >
                <View style={styles.photoMenuIcon}>
                  <MaterialIcons
                    name="photo-library"
                    size={24}
                    color="#173B75"
                  />
                </View>

                <View style={styles.photoMenuOptionText}>
                  <Text style={styles.photoMenuOptionTitle}>
                    Choose from gallery
                  </Text>
                  <Text style={styles.photoMenuOptionSubtitle}>
                    Select existing photos
                  </Text>
                </View>

                <MaterialIcons
                  name="chevron-right"
                  size={24}
                  color="#64748B"
                />
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.photoMenuCancel}
                onPress={() => setPhotoMenuVisible(false)}
              >
                <Text style={styles.photoMenuCancelText}>
                  Cancel
                </Text>
              </TouchableOpacity>

            </View>
          </View>
        </Modal>
        </TouchableOpacity>

        <TouchableOpacity
          style={[
            styles.addButton,
            (backupInProgress || !storageLoaded) && { opacity: 0.5 },
          ]}
          onPress={addTask}
          accessibilityRole="button"
          accessibilityLabel="Submit campus report"
          disabled={backupInProgress || !storageLoaded}
        >
          <MaterialIcons name="add-circle-outline" size={28} color="#183B80" />
        </TouchableOpacity>
      </View>

      {/* Backup management menu */}
      <Modal
        visible={backupMenuVisible}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setBackupMenuVisible(false)}
      >
        <View style={styles.photoMenuOverlay}>
          <View style={styles.photoMenuContainer}>
            <Text style={styles.photoMenuTitle}>
              Data management
            </Text>

            <Text style={styles.photoMenuSubtitle}>
              Export or restore your campus reports
            </Text>

            <TouchableOpacity
              style={styles.photoMenuOption}
              accessibilityRole="button"
              accessibilityLabel="Export backup"
              onPress={() => {
                setBackupMenuVisible(false);
                exportBackup();
              }}
            >
              <MaterialIcons
                name="file-download"
                size={26}
                color="#183B80"
              />
              <Text style={styles.photoMenuOptionText}>
                Export Backup
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.photoMenuOption}
              accessibilityRole="button"
              accessibilityLabel="Import backup"
              onPress={() => {
                setBackupMenuVisible(false);
                importBackup();
              }}
            >
              <MaterialIcons
                name="file-upload"
                size={26}
                color="#183B80"
              />
              <Text style={styles.photoMenuOptionText}>
                Import Backup
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.photoMenuCancel}
              accessibilityRole="button"
              onPress={() => setBackupMenuVisible(false)}
            >
              <Text style={styles.photoMenuCancelText}>
                Cancel
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Full-screen photo viewer */}
      <Modal
        visible={selectedPhoto !== null}
        transparent={false}
        animationType="fade"
        onRequestClose={() => setSelectedPhoto(null)}
      >
        <View
          style={styles.photoViewerContainer}
          {...gallerySwipe.panHandlers}
        >
          <TouchableOpacity
            style={styles.photoViewerCloseButton}
            accessibilityRole="button"
            accessibilityLabel="Close photo viewer"
            onPress={() => setSelectedPhoto(null)}
          >
            <MaterialIcons
              name="close"
              size={32}
              color="#FFFFFF"
            />
          </TouchableOpacity>

          {selectedPhoto && (
            <Image
              source={{ uri: selectedPhoto }}
              style={styles.fullScreenPhoto}
              resizeMode="contain"
              pointerEvents="none"
            />
          )}
          {/* Previous photo button */}
          {galleryIndex > 0 && (
            <TouchableOpacity
              style={[styles.galleryArrow, { left: 15 }]}
              onPress={() => navigatePhoto(-1)}
              accessibilityRole="button"
              accessibilityLabel="Previous photo"
            >
              <MaterialIcons
                name="chevron-left"
                size={40}
                color="#FFFFFF"
              />
            </TouchableOpacity>
          )}

          {/* Next photo button */}
          {galleryIndex < galleryPhotos.length - 1 && (
            <TouchableOpacity
              style={[styles.galleryArrow, { right: 15 }]}
              onPress={() => navigatePhoto(1)}
              accessibilityRole="button"
              accessibilityLabel="Next photo"
            >
              <MaterialIcons
                name="chevron-right"
                size={40}
                color="#FFFFFF"
              />
            </TouchableOpacity>
          )}

          {/* Photo counter */}
          <Text style={styles.galleryCounter}>
            {galleryIndex + 1} / {galleryPhotos.length}
          </Text>
        </View>
      </Modal>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  // Photo gallery navigation arrows.
  galleryArrow: {
    position: "absolute",
    top: "50%",
    marginTop: -24,
    zIndex: 10,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    borderRadius: 24,
    padding: 4,
  },

  // Photo gallery counter.
  galleryCounter: {
    position: "absolute",
    bottom: 50,
    alignSelf: "center",
    zIndex: 10,
    color: "#FFFFFF",
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    fontSize: 16,
    fontWeight: "bold",
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
  },
  // Full-screen photo viewer.
  photoViewerContainer: {
    flex: 1,
    backgroundColor: "#000000",
    justifyContent: "center",
    alignItems: "center",
  },
  photoViewerCloseButton: {
    position: "absolute",
    top: 50,
    right: 20,
    zIndex: 10,
    backgroundColor: "rgba(255, 255, 255, 0.2)",
    borderRadius: 24,
    padding: 8,
  },
  fullScreenPhoto: {
    width: "100%",
    height: "100%",
  },
    // Photo source selection menu.
  photoMenuOverlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.45)",
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },

  photoMenuContainer: {
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    padding: 20,
    width: "100%",
    maxWidth: 480,
  },

  photoMenuTitle: {
    fontSize: 20,
    fontWeight: "bold",
    color: "#173B75",
    marginBottom: 6,
  },

  photoMenuSubtitle: {
    fontSize: 14,
    color: "#64748B",
    marginBottom: 16,
  },

  photoMenuOption: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#E2E8F0",
  },

  photoMenuIcon: {
    width: 46,
    height: 46,
    borderRadius: 12,
    backgroundColor: "#DBEAFE",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 12,
  },

  photoMenuOptionText: {
    flex: 1,
  },

  photoMenuOptionTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: "#173B75",
    marginBottom: 4,
  },

  photoMenuOptionSubtitle: {
    fontSize: 13,
    color: "#64748B",
  },

  photoMenuCancel: {
    alignItems: "center",
    paddingTop: 18,
    paddingBottom: 4,
  },

  photoMenuCancelText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#173B75",
  },
  container: {
    flex: 1,
    backgroundColor: "#183B80",
    paddingTop: 3,
    paddingHorizontal: 20,
  },
  header: {
    marginBottom: 10,
    paddingTop: 0,
  },
  // Position the options button without increasing header height.
  moreOptionsButton: {
    position: "absolute",
    top: 0,
    right: 0,
    width: 48,
    height: 48,
    justifyContent: "center",
    alignItems: "center",
    zIndex: 10,
  },
  campusLabel: {
    color: "#F5B82E",
    fontSize: 12,
    fontWeight: "bold",
    letterSpacing: 2,
    marginBottom: 0,
  },
  subtitle: {
    color: "#DCE8FF",
    fontSize: 13,
    marginTop: 0,
  },
  title: {
    color: "#FFFFFF",
    fontSize: 32,
    fontWeight: "bold",
  },
  date: {
    color: "white",
    fontSize: 18,
  },
  list: {
    flex: 1,
    marginRight: -18,
    paddingRight: 12,
  },
  emptyText: {
    color: "white",
    fontSize: 26,
    fontWeight: "bold",
    textAlign: "center",
    marginTop: 130,
  },
  task: {
    backgroundColor: "whitesmoke",
    borderRadius: 10,
    padding: 15,
    marginBottom: 15,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  taskText: {
    color: "black",
    fontSize: 18,
    flex: 1,
  },
  taskContent: {
    flex: 1,
  },
  badgeRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    marginTop: 8,
    marginBottom: 5,
  },
  categoryBadge: {
    backgroundColor: "#FFF0BD",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
  },
  categoryBadgeText: {
    color: "#775000",
    fontSize: 11,
    fontWeight: "bold",
  },
  statusBadge: {
    backgroundColor: "#DBEAFE",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
  },
  statusBadgeText: {
    color: "#1E40AF",
    fontSize: 11,
    fontWeight: "bold",
  },
  locationText: {
    color: "gray",
    fontSize: 12,
    marginTop: 5,
  },
  categorySection: {
    marginBottom: 15,
  },
  filterSection: {
    marginBottom: 15,
  },
  categoryTitle: {
    color: "#F5B82E",
    fontSize: 12,
    fontWeight: "bold",
    letterSpacing: 1,
    marginBottom: 10,
  },
  categoryContainer: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  categoryButton: {
    backgroundColor: "#DCE8FF",
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 18,
  },
  categorySelected: {
    backgroundColor: "#F5B82E",
  },
  categoryButtonText: {
    color: "#183B80",
    fontSize: 12,
    fontWeight: "600",
  },
  categorySelectedText: {
    color: "#183B80",
    fontWeight: "bold",
  },
  inputRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 3,
    gap: 10,
  },
  input: {
    flex: 1,
    backgroundColor: "white",
    borderRadius: 10,
    padding: 12,
    fontSize: 18,
  },
  addButton: {
    backgroundColor: "whitesmoke",
    borderRadius: 10,
    padding: 12,
  },

  reportCountRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },

  reportCountText: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "600",
  },

  reportCountBadge: {
    color: "#183B80",
    backgroundColor: "#DCE8FF",
    fontSize: 12,
    fontWeight: "bold",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
    overflow: "hidden",
  },
  
  searchSection: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    borderRadius: 10,
    paddingHorizontal: 12,
    marginBottom: 12,
  },

  searchInput: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 8,
    fontSize: 14,
    color: "#183B80",
  },
    sortSection: {
    marginBottom: 12,
  },
  // Layout for expandable section headers.
  collapsibleHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    minHeight: 44,
  },

  dashboardSection: {
    marginBottom: 15,
  },

  dashboardGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    gap: 8,
  },

  dashboardCard: {
    width: "48%",
    borderRadius: 10,
    padding: 8,
  },

  dashboardLabel: {
    fontSize: 12,
    fontWeight: "600",
  },

  dashboardValue: {
    fontSize: 20,
    fontWeight: "bold",
    marginTop: 2,
  },

  cameraButton: {
    backgroundColor: "#FFFFFF",
    borderRadius: 10,
    width: 48,
    height: 48,
    justifyContent: "center",
    alignItems: "center",
    marginRight: 8,
  },


  photoPreview: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 8,
    gap: 8,
  },

  photoPreviewImage: {
    width: 64,
    height: 64,
    borderRadius: 8,
  },


  reportPhotosSection: {
    marginTop: 10,
    marginBottom: 8,
  },

  reportPhotosLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: "#64748B",
    marginBottom: 6,
  },

  reportPhotosGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },

  reportPhotoImage: {
    width: 65,
    height: 65,
    borderRadius: 8,
  },

});
