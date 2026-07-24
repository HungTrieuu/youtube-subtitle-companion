import { execFile } from "node:child_process";
import { access, constants } from "node:fs/promises";
import { delimiter, join } from "node:path";
import { promisify } from "node:util";

import { logger } from "./logger";

const execFileAsync = promisify(execFile);
const mprisBusPrefix = "org.mpris.MediaPlayer2.";
const playbackStatuses = new Set(["Playing", "Paused", "Stopped"]);

type MediaBackendName = "playerctl" | "mpris-dbus" | "xdotool";

type MediaBackend = {
  name: MediaBackendName;
  toggle(): Promise<void>;
};

const execFileText = async (filePath: string, args: string[]): Promise<string> => {
  const { stdout } = await execFileAsync(filePath, args, {
    encoding: "utf8"
  });

  return stdout;
};

const isExecutable = async (filePath: string): Promise<boolean> => {
  try {
    await access(filePath, constants.X_OK);
    return true;
  } catch {
    return false;
  }
};

const resolveExecutable = async (command: string): Promise<string | null> => {
  const pathValue = process.env.PATH;

  if (!pathValue) {
    return null;
  }

  const directories = [...new Set(pathValue.split(delimiter).filter(Boolean))];

  for (const directory of directories) {
    const filePath = join(directory, command);

    if (await isExecutable(filePath)) {
      return filePath;
    }
  }

  return null;
};

const readQuotedStrings = (stdout: string): string[] =>
  [...stdout.matchAll(/"([^"]+)"/g)].map((match) => match[1]);

const listMprisPlayers = async (dbusSendPath: string): Promise<string[]> => {
  const stdout = await execFileText(dbusSendPath, [
    "--session",
    "--dest=org.freedesktop.DBus",
    "--type=method_call",
    "--print-reply",
    "/org/freedesktop/DBus",
    "org.freedesktop.DBus.ListNames"
  ]);

  return readQuotedStrings(stdout).filter((name) => name.startsWith(mprisBusPrefix));
};

const readPlaybackStatus = async (
  dbusSendPath: string,
  serviceName: string
): Promise<string | null> => {
  const stdout = await execFileText(dbusSendPath, [
    "--session",
    `--dest=${serviceName}`,
    "--type=method_call",
    "--print-reply",
    "/org/mpris/MediaPlayer2",
    "org.freedesktop.DBus.Properties.Get",
    "string:org.mpris.MediaPlayer2.Player",
    "string:PlaybackStatus"
  ]);

  for (const value of readQuotedStrings(stdout)) {
    if (playbackStatuses.has(value)) {
      return value;
    }
  }

  return null;
};

const selectMprisPlayer = async (dbusSendPath: string): Promise<string | null> => {
  const players = await listMprisPlayers(dbusSendPath);

  if (players.length === 0) {
    return null;
  }

  let firstPausedPlayer: string | null = null;

  for (const player of players) {
    try {
      const status = await readPlaybackStatus(dbusSendPath, player);

      if (status === "Playing") {
        return player;
      }

      if (status === "Paused" && firstPausedPlayer === null) {
        firstPausedPlayer = player;
      }
    } catch (error) {
      logger.debug("system-media", "Failed to inspect MPRIS playback status", {
        player,
        error
      });
    }
  }

  return firstPausedPlayer ?? players[0];
};

const toggleWithMpris = async (dbusSendPath: string): Promise<void> => {
  const player = await selectMprisPlayer(dbusSendPath);

  if (player === null) {
    throw new Error("No active MPRIS player was found on the session bus");
  }

  await execFileAsync(dbusSendPath, [
    "--session",
    `--dest=${player}`,
    "--type=method_call",
    "--print-reply",
    "/org/mpris/MediaPlayer2",
    "org.mpris.MediaPlayer2.Player.PlayPause"
  ]);
};

const buildBackends = async (): Promise<MediaBackend[]> => {
  const playerctlPath = await resolveExecutable("playerctl");
  const dbusSendPath = await resolveExecutable("dbus-send");
  const xdotoolPath = await resolveExecutable("xdotool");
  const backends: MediaBackend[] = [];

  if (playerctlPath !== null) {
    backends.push({
      name: "playerctl",
      toggle: async () => {
        await execFileAsync(playerctlPath, ["play-pause"]);
      }
    });
  }

  if (dbusSendPath !== null) {
    backends.push({
      name: "mpris-dbus",
      toggle: async () => {
        await toggleWithMpris(dbusSendPath);
      }
    });
  }

  if (xdotoolPath !== null) {
    backends.push({
      name: "xdotool",
      toggle: async () => {
        await execFileAsync(xdotoolPath, ["key", "XF86AudioPlay"]);
      }
    });
  }

  return backends;
};

export class SystemMediaController {
  private readonly backendPromise = buildBackends();
  private inFlightToggle: Promise<boolean> | null = null;

  public async togglePlayPause(): Promise<boolean> {
    if (process.platform !== "linux") {
      logger.warn("system-media", "System media play or pause hotkey is only implemented on Linux");
      return false;
    }

    if (this.inFlightToggle !== null) {
      return this.inFlightToggle;
    }

    const task = this.runToggle().finally(() => {
      this.inFlightToggle = null;
    });

    this.inFlightToggle = task;
    return task;
  }

  private async runToggle(): Promise<boolean> {
    const backends = await this.backendPromise;

    if (backends.length === 0) {
      logger.warn(
        "system-media",
        "No supported Linux media-control backend was found; install playerctl or expose an MPRIS player"
      );
      return false;
    }

    const failures: Array<{ backend: MediaBackendName; error: unknown }> = [];

    for (const backend of backends) {
      try {
        await backend.toggle();
        logger.debug("system-media", "Toggled system media playback", {
          backend: backend.name
        });
        return true;
      } catch (error) {
        failures.push({
          backend: backend.name,
          error
        });
      }
    }

    logger.warn("system-media", "Failed to toggle system media playback", {
      failures
    });
    return false;
  }
}

export const systemMediaController = new SystemMediaController();
