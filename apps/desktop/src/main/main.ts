import { app } from "electron";

import { bootstrapDesktopApp } from "./bootstrap/register-app-lifecycle";
import { logger } from "./logger";
import { removeDesktopProcessState } from "./runtime-state";

const useWayland = process.env.YSC_FORCE_WAYLAND === "1";
const forceX11 = process.platform === "linux" && !useWayland;

if (process.platform === "linux") {
  if (forceX11) {
    app.commandLine.appendSwitch("ozone-platform", "x11");
  }

  app.commandLine.appendSwitch(
    "enable-features",
    "GlobalShortcutsPortal,GlobalShortcutsPortalPreferredTrigger"
  );
}

void bootstrapDesktopApp().catch((error) => {
  logger.error("bootstrap", "Failed to start desktop app", error);
  void removeDesktopProcessState().catch((cleanupError) => {
    logger.warn("bootstrap", "Failed to remove desktop runtime state after bootstrap error", cleanupError);
  });
  app.quit();
});
