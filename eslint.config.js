import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";

export default tseslint.config(
  {
    ignores: [
      "dist",
      "test-results",
      "release",
      "node_modules",
      "src-tauri/target",
      ".tools",
      ".handoff-extracted",
      "SteamHub_Prepared_Handoff",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.{ts,tsx}"],
    languageOptions: { globals: globals.browser },
    plugins: { "react-hooks": reactHooks, "react-refresh": reactRefresh },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": [
        "warn",
        {
          allowConstantExport: true,
          allowExportNames: [
            "buttonVariants",
            "badgeVariants",
            "tabsListVariants",
          ],
        },
      ],
    },
  },
  {
    files: ["*.js", "scripts/*.mjs"],
    languageOptions: { globals: globals.node },
  },
);
