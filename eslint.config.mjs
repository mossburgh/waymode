import js from "@eslint/js";
import tseslint from "typescript-eslint";
import sonarjs from "eslint-plugin-sonarjs";
import prettier from "eslint-config-prettier";
import globals from "globals";
import vitest from "@vitest/eslint-plugin";

const sourceFiles = ["**/*.{ts,tsx,mjs,js}"];
export default tseslint.config(
  {
    ignores: [
      "node_modules/**",
      ".agents/skills/**",
      "dist/**",
      "artifacts/**",
      "brag-output*/**",
      ".demo-data/**",
    ],
  },
  {
    linterOptions: {
      noInlineConfig: true,
      reportUnusedDisableDirectives: "error",
    },
  },
  js.configs.recommended,
  {
    files: sourceFiles,
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
  {
    files: ["**/*.{ts,tsx}"],
    extends: [...tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ["**/*.test.{ts,tsx,mjs,js}"],
    plugins: { vitest },
    rules: {
      ...vitest.configs.recommended.rules,
      "vitest/no-disabled-tests": "error",
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "CallExpression[callee.property.name='skipIf'][arguments.0.value=true]",
          message: "Use a real environment condition for opt-in tests.",
        },
        {
          selector:
            "CallExpression[callee.property.name='runIf'][arguments.0.value=false]",
          message: "Use a real environment condition for opt-in tests.",
        },
      ],
    },
  },
  {
    files: ["tests/**/*.{ts,tsx,mjs,js}"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "Program",
          message:
            "Colocate tests and fixtures with their owner. Do not add a root tests/ tree.",
        },
      ],
    },
  },
  prettier,
  {
    files: sourceFiles,
    plugins: { sonarjs },
    rules: {
      curly: ["error", "all"],
      complexity: ["error", 10],
      "sonarjs/cognitive-complexity": ["error", 10],
      "max-depth": ["error", 3],
      "max-lines-per-function": [
        "error",
        { max: 40, skipBlankLines: true, skipComments: true },
      ],
      "no-nested-ternary": "error",
      eqeqeq: ["error", "always"],
      "no-var": "error",
      "prefer-const": "error",
      "no-else-return": "error",
      "no-implicit-coercion": "error",
      "no-throw-literal": "error",
      "no-warning-comments": [
        "error",
        { terms: ["todo", "fixme", "xxx"], location: "start" },
      ],
    },
  },
  {
    files: ["**/*.{ts,tsx}"],
    rules: { "@typescript-eslint/require-await": "off" },
  },
);
