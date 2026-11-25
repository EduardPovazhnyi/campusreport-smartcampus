import { File, Directory, Paths } from "expo-file-system";

// Permanent directory for report photos.
const photosDirectory = new Directory(
  Paths.document,
  "campus-report-photos"
);

// Save a photo from its temporary URI.
export const savePhoto = async (sourceUri) => {
  photosDirectory.create({
    idempotent: true,
    intermediates: true,
  });

  const photoId =
    Date.now().toString() +
    "-" +
    Math.random().toString(36).slice(2) +
    ".jpg";

  const sourceFile = new File(sourceUri);
  const destinationFile = new File(photosDirectory, photoId);

  sourceFile.copy(destinationFile);

  return photoId;
};

// Get the permanent URI of a saved photo.
export const getPhoto = async (photoId) => {
  const photoFile = new File(photosDirectory, photoId);

  return photoFile.exists ? photoFile.uri : null;
};

// Delete a saved photo.
export const deletePhoto = async (photoId) => {
  const photoFile = new File(photosDirectory, photoId);

  if (photoFile.exists) {
    photoFile.delete();
  }
};
