import Store from "electron-store";

import type { AppConfig } from "../common/types";
import { mergeConfig, sanitizeConfig, type AppConfigPatch } from "./config";

type StoredShape = {
  config: AppConfig;
};

export class DesktopConfigStore {
  private readonly store: Store<StoredShape>;

  public constructor() {
    this.store = new Store<StoredShape>({
      name: "youtube-subtitle-companion",
      clearInvalidConfig: false,
      defaults: {
        config: sanitizeConfig(undefined)
      }
    });

    const sanitized = sanitizeConfig(this.store.get("config"));
    this.store.set("config", sanitized);
  }

  public getConfig(): AppConfig {
    return sanitizeConfig(this.store.get("config"));
  }

  public setConfig(config: AppConfig): AppConfig {
    const sanitized = sanitizeConfig(config);
    this.store.set("config", sanitized);
    return sanitized;
  }

  public updateConfig(patch: AppConfigPatch): AppConfig {
    const next = mergeConfig(this.getConfig(), patch);
    this.store.set("config", next);
    return next;
  }
}
