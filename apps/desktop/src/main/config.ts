import { z } from "zod";

import type { AppConfig } from "../common/types";

export type AppConfigPatch = Omit<Partial<AppConfig>, "hotkeys"> & {
  hotkeys?: Partial<AppConfig["hotkeys"]>;
};

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

export const appConfigSchema = z.object({
  overlayVisible: z.boolean(),
  clickThrough: z.boolean(),
  fontSize: z.number().int().min(16).max(64),
  opacity: z.number().min(0.3).max(1),
  width: z.number().int().min(320).max(2200),
  height: z.number().int().min(80).max(600),
  x: z.number().int().optional(),
  y: z.number().int().optional(),
  alignment: z.enum(["left", "center", "right"]),
  autoStart: z.boolean(),
  hotkeys: z.object({
    togglePlay: z.string().min(1),
    toggleSystemMedia: z.string().min(1),
    seekBack: z.string().min(1),
    seekForward: z.string().min(1),
    toggleOverlay: z.string().min(1),
    toggleInteraction: z.string().min(1),
    moveOverlay: z.string().min(1),
    temporaryDim: z.string().min(1),
    increaseFont: z.string().min(1),
    decreaseFont: z.string().min(1)
  })
});

const partialConfigSchema = appConfigSchema.partial().extend({
  hotkeys: appConfigSchema.shape.hotkeys.partial().optional()
});

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
  const parsed = partialConfigSchema.safeParse(input);

  if (!parsed.success) {
    return cloneDefaultConfig();
  }

  return migrateLegacyHotkeys(mergeConfig(cloneDefaultConfig(), parsed.data));
};
