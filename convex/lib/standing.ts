import type { MutationCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { isProfileComplete } from "./profile";
import { writeAudit } from "./audit";
import { notify } from "./notify";

// Standing, Ladder 2, Rung 2 only (Recognition Thresholds decision): the
// AUTOMATIC binary gate member -> active_member when BOTH hold: profile
// complete AND at least one qualifying action (attended an event, applied to
// an opportunity). Rungs 3-4 (Ambassador, Leadership Circle) belong to the
// later recognition-engine slice: nothing here may write them, and standing
// never moves DOWN automatically (dormancy is a lifecycle matter, not a
// demotion). Every change appends standingHistory + an audit row and tells
// the member in plain words.

export const currentStanding = (
  member: Doc<"members">,
): "member" | "active_member" | "ambassador" | "leadership_circle" =>
  member.standing ?? "member";

// Call after any event that could satisfy the gate: profile save, attendance
// marked, application submitted. Idempotent; only promotes member -> active.
export const maybePromoteToActive = async (
  ctx: MutationCtx,
  memberId: Id<"members">,
  qualifyingAction: string, // plain words, e.g. "attended an event"
): Promise<boolean> => {
  const member = await ctx.db.get(memberId);
  if (member === null) return false;
  if (currentStanding(member) !== "member") return false;
  if (member.lifecycle_state !== "active") return false;
  if (!isProfileComplete(member)) return false;

  const hasAttendance = await ctx.db
    .query("eventRegistrations")
    .withIndex("by_member_time", (q) => q.eq("member_id", memberId))
    .collect()
    .then((rows) => rows.some((r) => r.state === "attended"));
  const hasApplication = await ctx.db
    .query("opportunityApplications")
    .withIndex("by_member_time", (q) => q.eq("member_id", memberId))
    .collect()
    .then((rows) => rows.some((r) => r.state !== "withdrawn"));
  if (!hasAttendance && !hasApplication) return false;

  await ctx.db.patch(memberId, { standing: "active_member" });
  await ctx.db.insert("standingHistory", {
    member_id: memberId,
    from_standing: "member",
    to_standing: "active_member",
    reason: `profile complete + ${qualifyingAction}`,
    timestamp: Date.now(),
  });
  await writeAudit(ctx, {
    actor: "system",
    role: "system",
    action: "standing.promote_active",
    target_id: memberId,
    after_summary: `standing member -> active_member (${qualifyingAction})`,
    source: "system",
  });
  // The directory is locked off for minor and restricted_unknown lanes, so
  // their promotion copy never promises it ("switched off, not supervised").
  const lockedLane =
    member.member_lane === "minor" || member.member_lane === "restricted_unknown";
  await notify(
    ctx,
    memberId,
    "standing_change",
    "You're now an Active Member",
    lockedLane
      ? "You completed your profile and took part. Active Members get early access when an event opens with a priority window."
      : "You completed your profile and took part. Active Members can appear in the member directory (if you choose) and get early access when an event opens with a priority window.",
    "/portal",
  );
  return true;
};
