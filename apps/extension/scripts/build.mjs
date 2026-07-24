import { watch as watchFile } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { build, context } from "esbuild";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.resolve(scriptDir, "..");
const workspaceRoot = path.resolve(projectDir, "../..");
const outDir = path.join(workspaceRoot, "dist/extension");

const prepareOutDir = async () => {
  await fs.rm(outDir, {
    recursive: true,
    force: true
  });
  await fs.mkdir(outDir, {
    recursive: true
  });
};

const copyStaticFiles = async () => {
  await fs.copyFile(path.join(projectDir, "manifest.json"), path.join(outDir, "manifest.json"));

  const publicDir = path.join(projectDir, "public");

  try {
    await fs.cp(publicDir, outDir, {
      recursive: true,
      force: true
    });
  } catch {
    return;
  }
};

const esbuildConfig = {
  entryPoints: {
    background: path.join(projectDir, "src/background.ts"),
    content: path.join(projectDir, "src/content.ts"),
    "page-bridge": path.join(projectDir, "src/page-bridge.ts")
  },
  outdir: outDir,
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "chrome120",
  sourcemap: true,
  logLevel: "info",
  tsconfig: path.join(projectDir, "tsconfig.json")
};

export const buildExtension = async ({ watch = false } = {}) => {
  await prepareOutDir();
  await copyStaticFiles();

  if (!watch) {
    await build(esbuildConfig);
    return {
      stop: async () => {}
    };
  }

  const buildContext = await context(esbuildConfig);
  await buildContext.watch();
  const manifestWatcher = watchFile(path.join(projectDir, "manifest.json"), async () => {
    await copyStaticFiles();
  });

  return {
    stop: async () => {
      manifestWatcher.close();
      await buildContext.dispose();
    }
  };
};

const isCliEntry = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
  : false;

if (isCliEntry) {
  const watch = process.argv.includes("--watch");
  const watcher = await buildExtension({ watch });

  if (!watch) {
    process.exit(0);
  }

  const shutdown = async () => {
    await watcher.stop();
    process.exit(0);
  };

  process.on("SIGINT", () => {
    void shutdown();
  });

  process.on("SIGTERM", () => {
    void shutdown();
  });
}
