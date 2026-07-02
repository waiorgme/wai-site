// The two opt-in toggles: pure eligibility + state rules (field spec Group H;
// Stage 0 §7 setPipelineOptIn/decidePipelineReview). Unit-tested.

import type { MemberLane } from "./memberLane";

// Both toggles are locked OFF for minors and unknown-age lanes, enforced
// server-side (the UI hiding them is presentation, never the control).
export const canUseToggles = (lane: MemberLane): boolean =>
  lane === "standard" || lane === "ally";

export type PipelineState = "off" | "review_pending" | "on" | "rejected";

// Member turns the pipeline toggle ON (with attestation): off/rejected may
// re-apply; pending and on stay as they are (idempotent).
export const pipelineStateOnOptIn = (
  current: PipelineState,
): PipelineState =>
  current === "on" ? "on" : current === "review_pending" ? "review_pending" : "review_pending";

// Member turns it OFF: always lands on off, whatever the state.
export const pipelineStateOnOptOut = (): PipelineState => "off";

// Admin decision on a pending review.
export const pipelineStateOnDecision = (
  decision: "approved" | "rejected",
): PipelineState => (decision === "approved" ? "on" : "rejected");

// What the future partner-search surface must respect (recorded for that
// slice): a member is searchable ONLY when all three hold. Lanes follow the
// shipped join/claim precedent (standard + ally may consent into the
// pipeline; minors and unknown-age never), pending any owner override.
export const isPipelineSearchable = (member: {
  member_lane: MemberLane;
  pipeline_state?: PipelineState;
  latest_pipeline_consent: boolean;
}): boolean =>
  canUseToggles(member.member_lane) &&
  member.pipeline_state === "on" &&
  member.latest_pipeline_consent;
