import type { Doc } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import { issueMembershipCertificate } from "./certificates";
import { ensurePipelineReviewOnActivation } from "./pipeline";
import { logActivity } from "./activity";

// The email-confirmed lifecycle advance (§6), moved verbatim out of
// auth.ts's beforeSessionCreation so the funnel wiring is testable through
// a plain function: minors → pending_guardian, unknown age → pending_review
// (SEC-3: never auto-activated, a human looks first), standard/ally
// (consents captured at join) → active. Returns the new state, or null when
// the member was not sitting at email_unverified (nothing to do).
export const confirmEmailForMember = async (
  ctx: MutationCtx,
  member: Doc<"members">,
): Promise<"active" | "pending_guardian" | "pending_review" | null> => {
  if (member.lifecycle_state !== "email_unverified") {
    return null;
  }
  const next =
    member.member_lane === "minor"
      ? "pending_guardian"
      : member.member_lane === "restricted_unknown"
        ? "pending_review"
        : "active";
  await ctx.db.patch(member._id, { lifecycle_state: next });
  await ctx.db.insert("auditLog", {
    actor: member.email,
    role: "member",
    action: "confirmMagicLink",
    target_id: member._id,
    before_summary: "lifecycle=email_unverified",
    after_summary: `lifecycle=${next}`,
    timestamp: Date.now(),
    source: "system",
  });
  // Funnel step 2 (activity-log spec §B.4): counted for every lane,
  // whatever state comes next - minors included, by decision.
  await logActivity(ctx, member._id, "email_confirmed");
  // The first win: issue the membership certificate the moment the email is
  // verified - but ONLY for members who reach `active` here. Minors get it
  // after guardian confirmation (a later slice); unknown-age accounts get it
  // after human review. Idempotent.
  if (next === "active") {
    await issueMembershipCertificate(ctx, member);
    // Pipeline invariant: if she gave the attested pipeline consent at
    // join, the eligibility review opens NOW, when the member is real.
    await ensurePipelineReviewOnActivation(ctx, member);
  }
  // 13-17: her email is verified, so the guardian's confirmation email
  // goes out now (Under-18 decision: a real confirmation step). Scheduled:
  // the send is an action (Resend network call), never inside this txn.
  if (next === "pending_guardian") {
    await ctx.scheduler.runAfter(0, internal.guardians.sendGuardianEmail, {
      memberId: member._id,
    });
  }
  return next;
};
