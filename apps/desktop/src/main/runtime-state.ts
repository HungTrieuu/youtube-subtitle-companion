import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const runtimeStateDir = path.join(os.tmpdir(), "youtube-subtitle-companion-desktop");
const runtimePidFile = path.join(runtimeStateDir, "desktop.pid");

type DesktopProcessState = {
  pid: number;
};

const parseProcessState = (input: string): DesktopProcessState | null => {
  try {
    const parsed = JSON.parse(input) as Partial<DesktopProcessState>;

    if (typeof parsed.pid !== "number" || !Number.isInteger(parsed.pid) || parsed.pid <= 0) {
      return null;
    }

    return {
      pid: parsed.pid
    };
  } catch {
    return null;
  }
};

export const writeDesktopProcessState = async (): Promise<void> => {
  await fs.mkdir(runtimeStateDir, { recursive: true });
  await fs.writeFile(
    runtimePidFile,
    `${JSON.stringify({
      pid: process.pid,
      startedAt: Date.now(),
      execPath: process.execPath
    })}\n`,
    "utf8"
  );
};

export const removeDesktopProcessState = async (): Promise<void> => {
  try {
    const raw = await fs.readFile(runtimePidFile, "utf8");
    const state = parseProcessState(raw);

    if (state !== null && state.pid !== process.pid) {
      return;
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return;
    }
  }

  await fs.rm(runtimePidFile, { force: true });
};
