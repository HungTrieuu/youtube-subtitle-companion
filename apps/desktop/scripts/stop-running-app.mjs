import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const runtimeStateDir = path.join(os.tmpdir(), "youtube-subtitle-companion-desktop");
const runtimePidFile = path.join(runtimeStateDir, "desktop.pid");
const desktopPort = 8765;

const parseTrackedPid = (input) => {
  try {
    const parsed = JSON.parse(input);
    return Number.isInteger(parsed?.pid) && parsed.pid > 0 ? parsed.pid : null;
  } catch {
    return null;
  }
};

const isProcessRunning = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error?.code === "ESRCH") {
      return false;
    }

    if (error?.code === "EPERM") {
      return true;
    }

    throw error;
  }
};

const waitForProcessExit = async (pid, timeoutMs) => {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (!isProcessRunning(pid)) {
      return true;
    }

    await delay(150);
  }

  return !isProcessRunning(pid);
};

const readTrackedPid = async () => {
  try {
    const raw = await fs.readFile(runtimePidFile, "utf8");
    const pid = parseTrackedPid(raw);

    if (pid === null || !isProcessRunning(pid)) {
      await fs.rm(runtimePidFile, { force: true });
      return null;
    }

    return pid;
  } catch (error) {
    if (error?.code === "ENOENT") {
      return null;
    }

    throw error;
  }
};

const collectUnixPortPids = () => {
  const lsof = spawnSync("lsof", ["-ti", `tcp:${desktopPort}`], {
    encoding: "utf8"
  });

  if (lsof.status === 0 && lsof.stdout.trim()) {
    return lsof.stdout
      .trim()
      .split(/\s+/)
      .map((value) => Number.parseInt(value, 10))
      .filter((value) => Number.isInteger(value) && value > 0);
  }

  const ss = spawnSync("ss", ["-ltnp", `sport = :${desktopPort}`], {
    encoding: "utf8"
  });

  if (ss.status !== 0 || !ss.stdout.trim()) {
    return [];
  }

  const matches = [...ss.stdout.matchAll(/pid=(\d+)/g)];
  return matches
    .map((match) => Number.parseInt(match[1] ?? "", 10))
    .filter((value) => Number.isInteger(value) && value > 0);
};

const collectWindowsPortPids = () => {
  const netstat = spawnSync("netstat", ["-ano", "-p", "tcp"], {
    encoding: "utf8"
  });

  if (netstat.status !== 0 || !netstat.stdout.trim()) {
    return [];
  }

  const matches = netstat.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) =>
      new RegExp(`:${desktopPort}\\s+.*LISTENING\\s+\\d+$`, "i").test(line)
    );

  return matches
    .map((line) => line.split(/\s+/).at(-1) ?? "")
    .map((value) => Number.parseInt(value, 10))
    .filter((value) => Number.isInteger(value) && value > 0);
};

const collectFallbackPids = () =>
  process.platform === "win32" ? collectWindowsPortPids() : collectUnixPortPids();

const terminateWindowsProcess = (pid, force) => {
  spawnSync("taskkill", ["/PID", String(pid), "/T", ...(force ? ["/F"] : [])], {
    stdio: "ignore"
  });
};

const terminateProcess = async (pid) => {
  if (!isProcessRunning(pid)) {
    return false;
  }

  if (process.platform === "win32") {
    terminateWindowsProcess(pid, false);

    if (await waitForProcessExit(pid, 5_000)) {
      return true;
    }

    terminateWindowsProcess(pid, true);

    if (await waitForProcessExit(pid, 2_000)) {
      return true;
    }
  } else {
    process.kill(pid, "SIGTERM");

    if (await waitForProcessExit(pid, 5_000)) {
      return true;
    }

    process.kill(pid, "SIGKILL");

    if (await waitForProcessExit(pid, 2_000)) {
      return true;
    }
  }

  throw new Error(`Failed to stop existing desktop app process ${pid}.`);
};

export const stopRunningDesktopApp = async () => {
  const trackedPid = await readTrackedPid();
  const candidatePids = new Set(
    trackedPid === null ? collectFallbackPids() : [trackedPid]
  );

  candidatePids.delete(process.pid);

  let stopped = false;

  for (const pid of candidatePids) {
    if (await terminateProcess(pid)) {
      stopped = true;
    }
  }

  if (stopped || trackedPid === null) {
    await fs.rm(runtimePidFile, { force: true });
  }

  return stopped;
};
