import {
  appConfigPatchSchema,
  appConfigSchema,
  type AppConfig,
  type AppConfigPatch
} from "../common/types";

export { appConfigPatchSchema, appConfigSchema } from "../common/types";
export type { AppConfigPatch } from "../common/types";

export const DEFAULT_CONFIG: AppConfig = {
  overlayVisible: true,
  clickThrough: true,
  fontSize: 28,
  opacity: 1,
  width: 700,
  height: 160,
  alignment: "center",
  autoStart: false,
  hotkeys: {
    togglePlay: "Control+Alt+Space",
    toggleSystemMedia: "Control+`",
    seekBack: "Control+Alt+Z",
    seekForward: "Control+Alt+X",
    toggleOverlay: "Control+Alt+S",
    toggleInteraction: "Control+Alt+A",
    moveOverlay: "Control+Alt+Y",
    temporaryDim: "Control+Alt+W",
    increaseFont: "Control+Alt+Up",
    decreaseFont: "Control+Alt+Down"
  }
};

const cloneDefaultConfig = (): AppConfig => structuredClone(DEFAULT_CONFIG);

const migrateLegacyHotkeys = (config: AppConfig): AppConfig => {
  let nextHotkeys = config.hotkeys;

  if (nextHotkeys.seekBack === "Control+Alt+Left") {
    nextHotkeys = {
      ...nextHotkeys,
      seekBack: DEFAULT_CONFIG.hotkeys.seekBack
    };
  }

  if (nextHotkeys.seekForward === "Control+Alt+Right") {
    nextHotkeys = {
      ...nextHotkeys,
      seekForward: DEFAULT_CONFIG.hotkeys.seekForward
    };
  }

  if (nextHotkeys.toggleInteraction === "Control+Alt+I") {
    nextHotkeys = {
      ...nextHotkeys,
      toggleInteraction: DEFAULT_CONFIG.hotkeys.toggleInteraction
    };
  }

  if (nextHotkeys === config.hotkeys) {
    return config;
  }

  return {
    ...config,
    hotkeys: nextHotkeys
  };
};

export const mergeConfig = (current: AppConfig, patch: AppConfigPatch): AppConfig => {
  const merged: AppConfig = {
    ...current,
    ...patch,
    hotkeys: {
      ...current.hotkeys,
      ...patch.hotkeys
    }
  };

  return appConfigSchema.parse(merged);
};

export const sanitizeConfig = (input: unknown): AppConfig => {
  const parsed = appConfigPatchSchema.safeParse(input);

  if (!parsed.success) {
    return cloneDefaultConfig();
  }

  return migrateLegacyHotkeys(mergeConfig(cloneDefaultConfig(), parsed.data));
};
