import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildDesktop } from "./build.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.resolve(scriptDir, "..");
const electronBinary = process.platform === "win32" ? "electron.cmd" : "electron";
const electronArgs = ["dist/main/main.js"];

if (process.platform === "linux" && process.env.ELECTRON_ENABLE_SANDBOX !== "1") {
  // Ubuntu Snap and similar environments often cannot use Electron's setuid sandbox in dev.
  electronArgs.push("--no-sandbox", "--disable-setuid-sandbox");
}

const watcher = await buildDesktop({ watch: true });

const child = spawn(electronBinary, electronArgs, {
  cwd: projectDir,
  stdio: "inherit",
  env: {
    ...process.env,
    NODE_ENV: "development"
  }
});

let shuttingDown = false;

const shutdown = async (exitCode = 0) => {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  child.kill();
  await watcher.stop();
  process.exit(exitCode);
};

child.on("exit", (code) => {
  void shutdown(code ?? 0);
});

process.on("SIGINT", () => {
  void shutdown();
});

process.on("SIGTERM", () => {
  void shutdown();
});
