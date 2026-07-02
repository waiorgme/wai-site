import { describe, expect, it } from "vitest";
import {
  canUseToggles,
  isPipelineSearchable,
  pipelineStateOnDecision,
  pipelineStateOnOptIn,
  pipelineStateOnOptOut,
} from "../../convex/lib/toggles";

describe("canUseToggles (locked off for minors + unknown age)", () => {
  it("standard and ally may use the toggles", () => {
    expect(canUseToggles("standard")).toBe(true);
    expect(canUseToggles("ally")).toBe(true);
  });

  it("minor and restricted_unknown are locked off", () => {
    expect(canUseToggles("minor")).toBe(false);
    expect(canUseToggles("restricted_unknown")).toBe(false);
  });
});

describe("pipeline state machine", () => {
  it("opt-in from off or rejected opens a review", () => {
    expect(pipelineStateOnOptIn("off")).toBe("review_pending");
    expect(pipelineStateOnOptIn("rejected")).toBe("review_pending");
  });

  it("opt-in is idempotent when already pending or on", () => {
    expect(pipelineStateOnOptIn("review_pending")).toBe("review_pending");
    expect(pipelineStateOnOptIn("on")).toBe("on");
  });

  it("opt-out always lands on off; decisions map to on/rejected", () => {
    expect(pipelineStateOnOptOut()).toBe("off");
    expect(pipelineStateOnDecision("approved")).toBe("on");
    expect(pipelineStateOnDecision("rejected")).toBe("rejected");
  });
});

describe("isPipelineSearchable (what the partner surface must respect)", () => {
  const base = {
    member_lane: "standard" as const,
    pipeline_state: "on" as const,
    latest_pipeline_consent: true,
  };

  it("requires eligible lane AND approved state AND live consent", () => {
    expect(isPipelineSearchable(base)).toBe(true);
    expect(isPipelineSearchable({ ...base, member_lane: "minor" })).toBe(false);
    expect(isPipelineSearchable({ ...base, member_lane: "restricted_unknown" })).toBe(false);
    expect(isPipelineSearchable({ ...base, pipeline_state: "review_pending" })).toBe(false);
    expect(isPipelineSearchable({ ...base, pipeline_state: "off" })).toBe(false);
    expect(isPipelineSearchable({ ...base, latest_pipeline_consent: false })).toBe(false);
  });
});
