import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import globals from "globals";

export default [
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: "module",
      globals: {
        ...globals.node,
      },
    },
    rules: {
      "no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  {
    // page.evaluate() runs inside the browser; allow browser globals there.
    files: ["src/auth/playwrightAuth.js"],
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.browser,
      },
    },
  },
  // Must be last: disables stylistic rules that conflict with Prettier.
  prettier,
  {
    ignores: ["node_modules/", ".data/", "../browser-extension/"],
  },
];
