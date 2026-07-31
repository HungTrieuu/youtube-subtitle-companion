import { globalShortcut } from "electron";

import { logger } from "../logger";
import { removeDesktopProcessState } from "../runtime-state";
import type { AppContext } from "../app-context";

const markAppQuitting = (context: AppContext): void => {
  context.session.isQuitting = true;
  context.overlayWindow.setQuitting(true);
};

export const shutdownAppContext = async (context: AppContext): Promise<void> => {
  if (context.session.shutdownStarted) {
    return;
  }

  context.session.shutdownStarted = true;
  markAppQuitting(context);

  if (context.session.temporaryDimResetTimer !== null) {
    clearTimeout(context.session.temporaryDimResetTimer);
    context.session.temporaryDimResetTimer = null;
  }

  context.session.runtimeSyncCleanup?.();
  context.session.runtimeSyncCleanup = null;

  globalShortcut.unregisterAll();
  context.trayController?.destroy();
  context.trayController = null;

  if (context.savedWordsWindow) {
    context.savedWordsWindow.destroy();
    context.savedWordsWindow = null;
  }

  try {
    await context.websocketServer.stop();
  } catch (error) {
    logger.error("ws", "Failed to stop WebSocket server cleanly", error);
  }

  try {
    await removeDesktopProcessState();
  } catch (error) {
    logger.warn("bootstrap", "Failed to remove desktop runtime state", error);
  }
};

export const prepareForQuit = (context: AppContext): void => {
  markAppQuitting(context);
};
