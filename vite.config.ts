import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  test: {
    // Component tests (src/components/__tests__/*.test.tsx) opt into a DOM
    // via a per-file `// @vitest-environment jsdom` pragma; everything else
    // (pure-helper src/**/*.test.ts, tools/*.test.mjs) keeps the default
    // node environment untouched. setupFiles only wires up jest-dom
    // matchers (toHaveAttribute etc.) — it doesn't force jsdom globally.
    setupFiles: ["./src/test/setup.ts"],
  },
});
