import { getAuthUserId } from "@convex-dev/auth/server";
import type { Doc } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { query } from "./_generated/server";
import { isProfileComplete } from "./lib/profile";

// Spec C10: everything the "My membership" page needs in one read - status,
// standing ladder position, member-since (truthful across the migration),
// membership certificate, the two opt-in states, plain standing history, and
// the HONEST Active Member next step (qualifying_progress mirrors exactly the
// automatic Rung-2 gate in lib/standing.ts, so what she is told to do next is
// what the promotion actually checks).

// Same auth resolution as members.ts (getAuthUserId then the by_userId member
// lookup). Local copy: members.ts keeps its helper module-private.
const memberForAuthedUser = async (ctx: QueryCtx) => {
  const userId = await getAuthUserId(ctx);
  if (userId === null) {
    return null;
  }
  return ctx.db
    .query("members")
    .withIndex("by_userId", (q) => q.eq("userId", userId))
    .unique();
};

export type MyMembership = {
  lifecycle_state: Doc<"members">["lifecycle_state"];
  standing: "member" | "active_member" | "ambassador" | "leadership_circle";
  // Date label. For migrated members this is when she FIRST joined WAI-ME
  // (original_joined_at, DATA-1), never the migration date.
  member_since: string;
  certificate: {
    number: number;
    status: "valid" | "superseded" | "revoked";
  } | null;
  directory_visible: boolean;
  pipeline_state: "off" | "review_pending" | "on" | "rejected";
  standing_history: Array<{
    from_standing: string;
    to_standing: string;
    reason: string;
    timestamp: number;
  }>;
  qualifying_progress: {
    profile_complete: boolean;
    has_attended: boolean;
    has_applied: boolean;
  };
};

export const getMyMembership = query({
  args: {},
  handler: async (ctx): Promise<MyMembership | null> => {
    const member = await memberForAuthedUser(ctx);
    if (member === null) {
      return null;
    }

    // Membership certificate: the current valid one; if a chain left none
    // valid (revoked without re-issue), show the newest so the page can say
    // so honestly. null until one is issued.
    const certificates = await ctx.db
      .query("certificates")
      .withIndex("by_member", (q) => q.eq("member_id", member._id))
      .collect();
    const membershipCerts = certificates
      .filter((c) => c.type === "membership")
      .sort((a, b) => b.issued_at - a.issued_at);
    const certificate =
      membershipCerts.find((c) => c.status === "valid") ??
      membershipCerts[0] ??
      null;

    const history = await ctx.db
      .query("standingHistory")
      .withIndex("by_member_time", (q) => q.eq("member_id", member._id))
      .order("desc")
      .collect();

    // The truthful Rung-2 progress: the SAME three conditions
    // lib/standing.ts's maybePromoteToActive checks (profile complete, an
    // attended event, a non-withdrawn application).
    const registrations = await ctx.db
      .query("eventRegistrations")
      .withIndex("by_member_time", (q) => q.eq("member_id", member._id))
      .collect();
    const applications = await ctx.db
      .query("opportunityApplications")
      .withIndex("by_member_time", (q) => q.eq("member_id", member._id))
      .collect();

    return {
      lifecycle_state: member.lifecycle_state,
      standing: member.standing ?? "member",
      member_since:
        member.original_joined_at ??
        new Date(member.created_at).toISOString().slice(0, 10),
      certificate:
        certificate === null
          ? null
          : {
              number: certificate.membership_number,
              status: certificate.status,
            },
      directory_visible: member.directory_visible ?? false,
      pipeline_state: member.pipeline_state ?? "off",
      standing_history: history.map((h) => ({
        from_standing: h.from_standing,
        to_standing: h.to_standing,
        reason: h.reason,
        timestamp: h.timestamp,
      })),
      qualifying_progress: {
        profile_complete: isProfileComplete(member),
        has_attended: registrations.some((r) => r.state === "attended"),
        has_applied: applications.some((a) => a.state !== "withdrawn"),
      },
    };
  },
});
