import { defineConfig } from "vitest/config";

// Unit tests for the pure server-side logic in convex/lib (QA-1). These run
// with no deployment and no browser: age derivation, lane evaluation,
// lifecycle legality, profile validation, rate-limit windows.
export default defineConfig({
  test: {
    include: ["tests/unit/**/*.test.ts"],
    environment: "node",
  },
});
