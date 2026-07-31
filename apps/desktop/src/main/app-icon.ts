import { app } from "electron";
import { existsSync } from "node:fs";
import path from "node:path";

const getBundledAssetPath = (fileName: string): string =>
  app.isPackaged
    ? path.join(process.resourcesPath, "assets", fileName)
    : path.resolve(__dirname, "../../assets", fileName);

export const getAppIconPath = (): string =>
  app.isPackaged
    ? path.join(process.resourcesPath, "assets", "icon.png")
    : path.resolve(__dirname, "../../../../icon.png");

export const getTrayIconPath = (): string => {
  const pngIconPath = getAppIconPath();

  if (existsSync(pngIconPath)) {
    return pngIconPath;
  }

  return getBundledAssetPath("icon.svg");
};
