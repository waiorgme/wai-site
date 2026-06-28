// §6 Member lifecycle: the allowed state transitions. Transitions are validated
// in code so an action can never move a member into an illegal state.

export type LifecycleState =
  | "email_unverified"
  | "consent_pending"
  | "pending_guardian"
  | "claim_pending"
  | "pending_review"
  | "active"
  | "dormant"
  | "suspended"
  | "erasure_requested"
  | "erasure_in_progress"
  | "archived";

export const LIFECYCLE_TRANSITIONS: Record<LifecycleState, LifecycleState[]> = {
  email_unverified: ["consent_pending", "pending_review"],
  consent_pending: ["active", "pending_guardian"],
  pending_guardian: ["active"],
  claim_pending: ["active"],
  pending_review: ["active", "suspended"],
  active: ["dormant", "suspended", "erasure_requested"],
  dormant: ["active", "erasure_requested"],
  suspended: ["active", "erasure_requested"],
  erasure_requested: ["erasure_in_progress"],
  erasure_in_progress: ["archived"],
  archived: [],
};

export const canTransition = (
  from: LifecycleState,
  to: LifecycleState,
): boolean => LIFECYCLE_TRANSITIONS[from].includes(to);
