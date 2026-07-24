import { globalShortcut } from "electron";

import type { AppConfig } from "../common/types";
import { logger } from "./logger";

type HotkeyHandlers = {
  togglePlay: () => void;
  seekBack: () => void;
  seekForward: () => void;
  toggleOverlay: () => void;
  toggleInteraction: () => void;
  moveOverlay: () => void;
  increaseFont: () => void;
  decreaseFont: () => void;
};

const registerShortcut = (accelerator: string, action: () => void, label: string): void => {
  const registered = globalShortcut.register(accelerator, action);

  if (!registered) {
    logger.warn("hotkeys", `Failed to register ${label} hotkey`, {
      accelerator
    });
    return;
  }

  logger.debug("hotkeys", `Registered ${label} hotkey`, {
    accelerator,
    isRegistered: globalShortcut.isRegistered(accelerator)
  });
};

export const registerHotkeys = (config: AppConfig, handlers: HotkeyHandlers): void => {
  globalShortcut.unregisterAll();

  registerShortcut(config.hotkeys.togglePlay, () => handlers.togglePlay(), "togglePlay");
  registerShortcut(config.hotkeys.seekBack, () => handlers.seekBack(), "seekBack");
  registerShortcut(config.hotkeys.seekForward, () => handlers.seekForward(), "seekForward");
  registerShortcut(
    config.hotkeys.toggleOverlay,
    () => handlers.toggleOverlay(),
    "toggleOverlay"
  );
  registerShortcut(
    config.hotkeys.toggleInteraction,
    () => handlers.toggleInteraction(),
    "toggleInteraction"
  );
  registerShortcut(config.hotkeys.moveOverlay, () => handlers.moveOverlay(), "moveOverlay");
  registerShortcut(config.hotkeys.increaseFont, () => handlers.increaseFont(), "increaseFont");
  registerShortcut(config.hotkeys.decreaseFont, () => handlers.decreaseFont(), "decreaseFont");
};
