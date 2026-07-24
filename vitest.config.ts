import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const rootDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^@youtube-subtitle-companion\/shared$/,
        replacement: path.resolve(rootDir, "packages/shared/src/index.ts")
      },
      {
        find: /^@youtube-subtitle-companion\/shared\/(.*)$/,
        replacement: path.resolve(rootDir, "packages/shared/src/$1")
      }
    ]
  },
  test: {
    environment: "node",
    include: ["packages/**/*.test.ts", "apps/**/*.test.ts"]
  }
});
