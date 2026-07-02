// The two opt-in toggles: pure eligibility + state rules (field spec Group H;
// Stage 0 §7 setPipelineOptIn/decidePipelineReview). Unit-tested.

import type { MemberLane } from "./memberLane";

// Both toggles are locked OFF for minors and unknown-age lanes, enforced
// server-side (the UI hiding them is presentation, never the control).
export const canUseToggles = (lane: MemberLane): boolean =>
  lane === "standard" || lane === "ally";

// The talent pipeline is stricter: it is women-only (Stage 0 §5: ally is
// never listed as a hireable candidate), so on top of the minor/unknown lock,
// ONLY the standard lane can opt in. Same rule the join, claim, and
// writeConsent paths already enforce.
export const canUsePipeline = (lane: MemberLane): boolean =>
  lane === "standard";

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
// slice): a member is searchable ONLY when all three hold. The lane rule is
// the shipped join/claim/writeConsent precedent: the pipeline is women-only,
// so ONLY standard; ally, minor and unknown-age are never searchable.
export const isPipelineSearchable = (member: {
  member_lane: MemberLane;
  pipeline_state?: PipelineState;
  latest_pipeline_consent: boolean;
}): boolean =>
  canUsePipeline(member.member_lane) &&
  member.pipeline_state === "on" &&
  member.latest_pipeline_consent;
