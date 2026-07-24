const PREFIX = "[yt-sub-companion:extension]";

export const extensionLogger = {
  debug(message: string, meta?: unknown): void {
    if (meta === undefined) {
      console.log(PREFIX, message);
      return;
    }

    console.log(PREFIX, message, meta);
  },
  warn(message: string, meta?: unknown): void {
    if (meta === undefined) {
      console.warn(PREFIX, message);
      return;
    }

    console.warn(PREFIX, message, meta);
  }
};
