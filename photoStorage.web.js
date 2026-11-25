const DB_NAME = "CampusReportPhotoStorage";
const STORE_NAME = "photos";
const DB_VERSION = 1;

// Open or create the IndexedDB database.
const openPhotoDatabase = () => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;

      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
};

// Save an image Blob and return its unique ID.
export const savePhoto = async (photoBlob) => {
  const db = await openPhotoDatabase();
  const photoId =
    Date.now().toString() +
    "-" +
    Math.random().toString(36).slice(2);

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);

    store.put(photoBlob, photoId);

    transaction.oncomplete = () => {
      db.close();
      resolve(photoId);
    };

    transaction.onerror = () => {
      db.close();
      reject(transaction.error);
    };
  });
};

// Retrieve a saved image Blob using its ID.
export const getPhoto = async (photoId) => {
  const db = await openPhotoDatabase();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readonly");
    const request = transaction.objectStore(STORE_NAME).get(photoId);

    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);

    transaction.oncomplete = () => db.close();
  });
};

// Delete a stored image using its ID.
export const deletePhoto = async (photoId) => {
  const db = await openPhotoDatabase();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).delete(photoId);

    transaction.oncomplete = () => {
      db.close();
      resolve();
    };

    transaction.onerror = () => {
      db.close();
      reject(transaction.error);
    };
  });
};
