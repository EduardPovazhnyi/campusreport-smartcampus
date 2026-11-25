import { Platform } from "react-native";

const getStorage = () => {
  if (Platform.OS === "web") {
    return require("./photoStorage.web");
  }

  return require("./photoStorage.native");
};

export const savePhoto = (...args) =>
  getStorage().savePhoto(...args);

export const getPhoto = (...args) =>
  getStorage().getPhoto(...args);

export const deletePhoto = (...args) =>
  getStorage().deletePhoto(...args);
