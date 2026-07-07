import type { MutationCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";

// The ActivityLog writers (activity-log spec §B). Append-only, called inside
// the same mutation transaction as the action they count, so a rolled-back
// mutation never leaves a phantom KPI row.

export type ActivityType = Doc<"activityLog">["type"];

export const logActivity = async (
  ctx: MutationCtx,
  memberId: Id<"members"> | undefined,
  type: ActivityType,
  ref?: string,
): Promise<void> => {
  await ctx.db.insert("activityLog", {
    member_id: memberId,
    type,
    ref,
    at: Date.now(),
  });
};

// Funnel steps count each member once: a second profile save is not a
// second onboarding start. With a ref, "once" means once per referenced
// thing instead (one RSVP row per event, however often she rebooks) - a
// member's rows per type stay in the dozens, so the index read is cheap.
export const logActivityOnce = async (
  ctx: MutationCtx,
  memberId: Id<"members">,
  type: ActivityType,
  ref?: string,
): Promise<void> => {
  const rows = await ctx.db
    .query("activityLog")
    .withIndex("by_member_type", (q) =>
      q.eq("member_id", memberId).eq("type", type),
    )
    .collect();
  const already =
    ref === undefined ? rows.length > 0 : rows.some((r) => r.ref === ref);
  if (!already) {
    await logActivity(ctx, memberId, type, ref);
  }
};
