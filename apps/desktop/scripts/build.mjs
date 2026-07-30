import { watch as watchFile } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { build, context } from "esbuild";

import { stopRunningDesktopApp } from "./stop-running-app.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.resolve(scriptDir, "..");
const outDir = path.join(projectDir, "dist");
const rendererOutDir = path.join(outDir, "renderer");
const staticRendererFiles = ["index.html", "overlay.css"];

const sharedOptions = {
  bundle: true,
  sourcemap: true,
  minify: false,
  logLevel: "info",
  tsconfig: path.join(projectDir, "tsconfig.json")
};

const buildConfigs = [
  {
    ...sharedOptions,
    entryPoints: [path.join(projectDir, "src/main/main.ts")],
    outfile: path.join(outDir, "main/main.js"),
    platform: "node",
    format: "cjs",
    target: "node20",
    external: ["electron"]
  },
  {
    ...sharedOptions,
    entryPoints: [path.join(projectDir, "src/preload/preload.ts")],
    outfile: path.join(outDir, "preload/preload.js"),
    platform: "node",
    format: "cjs",
    target: "node20",
    external: ["electron"]
  },
  {
    ...sharedOptions,
    entryPoints: [path.join(projectDir, "src/renderer/overlay.ts")],
    outfile: path.join(outDir, "renderer/overlay.js"),
    platform: "browser",
    format: "iife",
    target: "chrome120"
  }
];

const copyRendererFiles = async () => {
  await fs.mkdir(rendererOutDir, { recursive: true });

  await Promise.all(
    staticRendererFiles.map((fileName) =>
      fs.copyFile(
        path.join(projectDir, "src/renderer", fileName),
        path.join(rendererOutDir, fileName)
      )
    )
  );
};

const watchRendererStatics = () => {
  const watchers = staticRendererFiles.map((fileName) =>
    watchFile(path.join(projectDir, "src/renderer", fileName), async () => {
      await copyRendererFiles();
    })
  );

  return () => {
    for (const watcher of watchers) {
      watcher.close();
    }
  };
};

export const buildDesktop = async ({ watch = false } = {}) => {
  await copyRendererFiles();

  if (!watch) {
    await Promise.all(buildConfigs.map((config) => build(config)));
    return {
      stop: async () => {}
    };
  }

  const contexts = await Promise.all(buildConfigs.map((config) => context(config)));
  await Promise.all(contexts.map((ctx) => ctx.watch()));
  const stopWatchingStatics = watchRendererStatics();

  return {
    stop: async () => {
      await Promise.all(contexts.map((ctx) => ctx.dispose()));
      stopWatchingStatics();
    }
  };
};

const isCliEntry = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
  : false;

if (isCliEntry) {
  const watch = process.argv.includes("--watch");
  await stopRunningDesktopApp();
  const watcher = await buildDesktop({ watch });

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
