import { describe, expect, it } from "vitest";
import { canTransition, LIFECYCLE_TRANSITIONS } from "../../convex/lib/lifecycle";

describe("lifecycle transitions (§6)", () => {
  it("allows the documented forward paths", () => {
    expect(canTransition("email_unverified", "pending_review")).toBe(true);
    expect(canTransition("email_unverified", "consent_pending")).toBe(true);
    expect(canTransition("pending_guardian", "active")).toBe(true);
    expect(canTransition("pending_review", "active")).toBe(true);
    expect(canTransition("pending_review", "suspended")).toBe(true);
    expect(canTransition("claim_pending", "active")).toBe(true);
    expect(canTransition("active", "dormant")).toBe(true);
    expect(canTransition("dormant", "active")).toBe(true);
  });

  it("blocks illegal jumps", () => {
    expect(canTransition("active", "email_unverified")).toBe(false);
    expect(canTransition("pending_guardian", "suspended")).toBe(false);
    expect(canTransition("erasure_requested", "active")).toBe(false);
  });

  it("archived is terminal and erasure is one-way", () => {
    expect(LIFECYCLE_TRANSITIONS.archived).toHaveLength(0);
    expect(canTransition("erasure_requested", "erasure_in_progress")).toBe(true);
    expect(canTransition("erasure_in_progress", "archived")).toBe(true);
    expect(canTransition("erasure_in_progress", "active")).toBe(false);
  });
});
