import { describe, expect, it } from "vitest";
import {
  decideWindow,
  GLOBAL_DAY,
  PER_EMAIL_DAY,
  PER_EMAIL_SHORT,
} from "../../convex/lib/rateLimit";

const NOW = 1_000_000_000;
const RULE = { limit: 3, windowMs: 15 * 60 * 1000 };

describe("decideWindow (SEC-2 fixed windows)", () => {
  it("starts a fresh window when there is no state", () => {
    const d = decideWindow(null, RULE, NOW);
    expect(d.allowed).toBe(true);
    expect(d.next).toEqual({ window_start: NOW, count: 1 });
  });

  it("counts up inside the window until the limit", () => {
    let state = decideWindow(null, RULE, NOW).next;
    state = decideWindow(state, RULE, NOW + 1000).next;
    const third = decideWindow(state, RULE, NOW + 2000);
    expect(third.allowed).toBe(true);
    expect(third.next.count).toBe(3);
  });

  it("blocks the request over the limit and says when to retry", () => {
    const state = { window_start: NOW, count: 3 };
    const d = decideWindow(state, RULE, NOW + 60_000);
    expect(d.allowed).toBe(false);
    expect(d.retryAfterMs).toBe(RULE.windowMs - 60_000);
  });

  it("resets once the window has fully passed", () => {
    const state = { window_start: NOW, count: 3 };
    const d = decideWindow(state, RULE, NOW + RULE.windowMs);
    expect(d.allowed).toBe(true);
    expect(d.next).toEqual({ window_start: NOW + RULE.windowMs, count: 1 });
  });

  it("policy constants match the vault send limits (Stage 0: 3/hour, 10/day)", () => {
    expect(PER_EMAIL_SHORT).toEqual({ limit: 3, windowMs: 60 * 60 * 1000 });
    expect(PER_EMAIL_DAY).toEqual({ limit: 10, windowMs: 24 * 60 * 60 * 1000 });
    expect(GLOBAL_DAY.windowMs).toBe(24 * 60 * 60 * 1000);
  });

  it("the global cap stays below Resend's free-tier 100/day hard cap", () => {
    // If the upstream cap tripped first, the refusal would happen AFTER the
    // verification-code swap and burn a member's live link. Our cap must win.
    expect(GLOBAL_DAY.limit).toBeLessThan(100);
  });
});
