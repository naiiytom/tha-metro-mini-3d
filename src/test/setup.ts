// Vitest global setup for DOM-based component tests. Extends `expect` with
// jest-dom matchers (toHaveAttribute, etc.) used by
// src/components/__tests__/*.test.tsx. Node-only tests (tools/*.test.mjs,
// src/**/*.test.ts pure-helper tests) are unaffected — this file only wires
// up matchers, it doesn't change the test environment for any file that
// doesn't opt into jsdom via `// @vitest-environment jsdom`.
import "@testing-library/jest-dom/vitest";
