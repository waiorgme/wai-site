import { query } from "../_generated/server";
import { requireSuperAdmin } from "../lib/adminAuth";
import { maskName } from "../lib/adminMask";

// Admin claim-conflicts queue (spec criterion 2). Lists importedMembers rows in
// `conflict` / `suppressed_minor` for the two super admins, replacing Issam's
// daily `npx convex run` check of these rows (Migration & Claim-Wave Plan
// "Wave-run ops routine"). This is visibility only: it shows WHO is waiting and
// why, with masked identity (first name + last-initial, never the full row -
// this is a review queue, not a member-data browser, §8 PII-minimisation on
// read surfaces).
//
// resolveConflictAsClaimed is DELIBERATELY NOT BUILT here: Open Question 1
// (what a human admin's resolution does to the two duplicate-email rows) awaits
// an Issam/Mervat decision. dismissSuppressedMinor is not offered at all:
// suppressed_minor rows clear automatically when the record shows her 18
// (existing importBatch logic), and no admin action may force a minor's row
// claimable early (that would bypass the safeguarding age gate matchClaim
// enforces). The queue shows them read-only with the reason.

const DAY_MS = 24 * 60 * 60 * 1000;

export type ConflictRow = {
  rowId: string;
  masked_name: string;
  claim_state: "conflict" | "suppressed_minor";
  conflict_reason: string | null;
  match_signals: { email: boolean; name: boolean; mobile: boolean; dob: boolean };
  days_since_change: number;
};

export const listConflicts = query({
  args: {},
  handler: async (ctx): Promise<ConflictRow[]> => {
    await requireSuperAdmin(ctx);
    const now = Date.now();
    const conflicts = await ctx.db
      .query("importedMembers")
      .withIndex("by_claim_state", (q) => q.eq("claim_state", "conflict"))
      .collect();
    const minors = await ctx.db
      .query("importedMembers")
      .withIndex("by_claim_state", (q) => q.eq("claim_state", "suppressed_minor"))
      .collect();
    return [...conflicts, ...minors].map((row) => ({
      rowId: row._id,
      masked_name: maskName(row.name),
      claim_state: row.claim_state as "conflict" | "suppressed_minor",
      conflict_reason: row.conflict_reason ?? null,
      match_signals: row.match_signals,
      // "days since the row last changed": Convex stamps _creationTime; the
      // row's last mutation isn't separately tracked, so this is age since
      // creation, which for these review rows is age since they entered the
      // conflict state at import/claim time.
      days_since_change: Math.floor((now - row._creationTime) / DAY_MS),
    }));
  },
});
