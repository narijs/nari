import globals from "globals";
import tsParser from "@typescript-eslint/parser";
import tsPlugin from "@typescript-eslint/eslint-plugin";
import eslintJsPlugin from "@eslint/js";

export default [
  {
    rules: eslintJsPlugin.configs.recommended.rules,
  },
  {
    files: [ "**/*.ts" ],
    languageOptions: {
      parser: tsParser,
      globals: globals.node,
    },
    plugins: {
      "@typescript-eslint": tsPlugin,
    },
    rules: {
      ...tsPlugin.configs.recommended.rules,
      "no-console": "off",
      "@typescript-eslint/no-explicit-any": "off",
    }
  },
  {
    files: [ "**/__test__/*.ts" ],
    languageOptions: {
      globals: globals.jest,
    },
  },
];