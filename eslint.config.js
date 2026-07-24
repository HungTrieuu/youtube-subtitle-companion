import js from "@eslint/js";
import eslintConfigPrettier from "eslint-config-prettier";
import globals from "globals";
import path from "node:path";
import { fileURLToPath } from "node:url";
import tseslint from "typescript-eslint";

const rootDir = path.dirname(fileURLToPath(import.meta.url));

export default tseslint.config(
  {
    ignores: ["dist/**", "coverage/**", "**/*.d.ts", "**/*.tsbuildinfo"]
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked.map((config) => ({
    ...config,
    files: ["**/*.{ts,tsx}"]
  })),
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      parserOptions: {
        project: [
          "./tsconfig.eslint.json",
          "./apps/desktop/tsconfig.json",
          "./apps/extension/tsconfig.json",
          "./packages/shared/tsconfig.json"
        ],
        tsconfigRootDir: rootDir
      },
      globals: {
        ...globals.node,
        ...globals.browser,
        ...globals.serviceworker
      }
    },
    rules: {
      "@typescript-eslint/consistent-type-imports": [
        "error",
        {
          prefer: "type-imports"
        }
      ],
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": [
        "error",
        {
          checksVoidReturn: false
        }
      ]
    }
  },
  {
    files: ["**/*.{js,mjs,cjs}"],
    languageOptions: {
      globals: {
        ...globals.node
      }
    }
  },
  {
    files: ["apps/extension/src/**/*.{ts,js}", "apps/extension/tests/**/*.{ts,js}"],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.serviceworker,
        chrome: "readonly"
      }
    }
  },
  eslintConfigPrettier
);
