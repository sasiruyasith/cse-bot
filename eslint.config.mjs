// eslint.config.mjs
import next from "eslint-config-next";

/** @type {import("eslint").Linter.FlatConfig[]} */
export default [
  {
    ignores: ["node_modules/**", ".next/**"], // optional
  },
  ...next,
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "off", // turn off the rule that breaks your build
    },
  },
];
