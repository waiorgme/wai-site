import { defineConfig } from "vitest/config";

// Unit tests for the pure server-side logic in convex/lib (QA-1): age
// derivation, lane evaluation, lifecycle legality, profile validation,
// rate-limit windows. Plus convex-test integration regressions in tests/convex
// (magic-link send-limit placement, join-path safeguarding guards), which run
// the real Convex functions against an in-memory backend, no deployment.
export default defineConfig({
  test: {
    include: ["tests/unit/**/*.test.ts", "tests/convex/**/*.test.ts"],
    environment: "node",
  },
});
