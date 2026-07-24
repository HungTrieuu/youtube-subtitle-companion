import { app } from "electron";

type LogLevel = "debug" | "warn" | "error";

const isDevelopment = process.env.NODE_ENV === "development" || !app.isPackaged;

const shouldLog = (level: LogLevel): boolean => isDevelopment || level !== "debug";

const log = (level: LogLevel, scope: string, message: string, meta?: unknown): void => {
  if (!shouldLog(level)) {
    return;
  }

  const prefix = `[desktop:${scope}]`;
  const args = meta === undefined ? [prefix, message] : [prefix, message, meta];

  if (level === "debug") {
    console.debug(...args);
    return;
  }

  if (level === "warn") {
    console.warn(...args);
    return;
  }

  console.error(...args);
};

export const logger = {
  debug: (scope: string, message: string, meta?: unknown): void => {
    log("debug", scope, message, meta);
  },
  warn: (scope: string, message: string, meta?: unknown): void => {
    log("warn", scope, message, meta);
  },
  error: (scope: string, message: string, meta?: unknown): void => {
    log("error", scope, message, meta);
  }
};
