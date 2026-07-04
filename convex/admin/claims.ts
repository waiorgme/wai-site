import { v } from "convex/values";
import { mutation, query } from "../_generated/server";
import { requireSuperAdmin } from "../lib/adminAuth";
import { maskName } from "../lib/adminMask";
import { writeAudit } from "../lib/audit";
import { isValidJoinEmail, normalizeEmail } from "../lib/joinValidation";

// Admin claim-conflicts queue (spec criterion 2). Lists importedMembers rows in
// `conflict` / `suppressed_minor` for the two super admins, replacing Issam's
// daily `npx convex run` check of these rows (Migration & Claim-Wave Plan
// "Wave-run ops routine"). This is a review queue, not a member-data browser:
// identity is masked (first name + last-initial). The email is shown because it
// is the conflict KEY the admin must act on (same reasoning as the data-request
// queue's subject_email).
//
// Resolution mechanic DECIDED (Issam, 2026-07-04): correct + archive. The admin
// confirms which row is the verified person's, optionally corrects its email,
// and releases it back to `unclaimed` so it re-enters the NORMAL matchClaim path
// (no direct member linking, no shortcut past matchClaim's safeguards). The
// other row of a duplicate-email pair is NEVER auto-resolved: it stays
// permanently `conflict`, marked archived-as-conflict by its own explicit call.
// Nothing is ever deleted - the archived row is the trail.
//
// suppressed_minor rows stay read-only: they clear automatically when the record
// shows her 18 (existing importBatch logic), and no admin action forces a
// minor's row claimable early (that would bypass matchClaim's age gate).

const DAY_MS = 24 * 60 * 60 * 1000;

export type ConflictRow = {
  rowId: string;
  masked_name: string;
  normalized_email: string;
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
      normalized_email: row.normalized_email,
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

// Append a resolution note to conflict_reason WITHOUT losing the original
// reason, so the row stays a readable trail. Bounded so a note can't grow
// unboundedly across repeated calls.
const REASON_MAX = 600;
const appendNote = (existing: string | undefined, note: string): string => {
  const base = existing ?? "";
  const joined = base.length === 0 ? note : `${base}; ${note}`;
  return joined.length > REASON_MAX ? joined.slice(0, REASON_MAX) : joined;
};

// resolveConflictAsClaimed (criterion 2, decided mechanic). Confirms a
// `conflict` row as the verified person's row and RELEASES it to `unclaimed`.
// Optionally corrects its normalized_email (validated + lowercased/trimmed with
// the existing email helpers). The corrected email is rejected if it would
// collide with another importedMembers row that is NOT permanently-conflict
// (a collision with a `conflict` row is fine - that is the archived trail). The
// released row re-enters the normal matchClaim path; this never links a member
// directly. §8 audit: row ids + states only, no name/email/DOB in the summary.
export const resolveConflictAsClaimed = mutation({
  args: {
    rowId: v.id("importedMembers"),
    correctedEmail: v.optional(v.string()),
    note: v.optional(v.string()),
  },
  handler: async (
    ctx,
    args,
  ): Promise<
    | { ok: true; state: "unclaimed" }
    | { ok: false; error: "not_authorized" | "not_found" | "validation" | "email_collision" }
  > => {
    let adminEmail: string;
    try {
      adminEmail = await requireSuperAdmin(ctx);
    } catch {
      return { ok: false, error: "not_authorized" };
    }
    const row = await ctx.db.get(args.rowId);
    // Same neutral shape whether the row is missing or in the wrong state.
    if (row === null || row.claim_state !== "conflict") {
      return { ok: false, error: "not_found" };
    }

    let targetEmail = row.normalized_email;
    if (args.correctedEmail !== undefined) {
      if (!isValidJoinEmail(args.correctedEmail)) {
        return { ok: false, error: "validation" };
      }
      const corrected = normalizeEmail(args.correctedEmail);
      if (corrected !== row.normalized_email) {
        // Collision check: any OTHER row at the corrected email that is not
        // permanently-conflict blocks the correction (releasing into an already
        // active/claimable email would recreate the ambiguity we are resolving).
        const atCorrected = await ctx.db
          .query("importedMembers")
          .withIndex("by_normalized_email", (q) =>
            q.eq("normalized_email", corrected),
          )
          .collect();
        const blocking = atCorrected.some(
          (r) => r._id !== row._id && r.claim_state !== "conflict",
        );
        if (blocking) {
          return { ok: false, error: "email_collision" };
        }
      }
      targetEmail = corrected;
    }

    const note = (args.note ?? "").trim().slice(0, 200);
    const resolutionNote =
      `resolved by admin: released as verified` +
      (targetEmail !== row.normalized_email ? " with corrected email" : "") +
      (note.length > 0 ? ` (${note})` : "");

    await ctx.db.patch(row._id, {
      normalized_email: targetEmail,
      claim_state: "unclaimed",
      conflict_reason: appendNote(row.conflict_reason, resolutionNote),
    });
    await writeAudit(ctx, {
      actor: adminEmail,
      role: "admin_fallback",
      action: "resolveConflictAsClaimed",
      target_id: row._id,
      before_summary: `claim_state=conflict`,
      after_summary: `claim_state=unclaimed emailCorrected=${targetEmail !== row.normalized_email}`,
      source: "admin_fallback",
    });
    return { ok: true, state: "unclaimed" };
  },
});

// archiveConflictRow (criterion 2, the other side of the decided mechanic). The
// non-matching row of a duplicate-email pair stays PERMANENTLY `conflict`; this
// records that decision by appending a note. It does NOT change claim_state
// (never releases, never deletes - the row is the archived trail). §8 audit:
// row ids + states only.
export const archiveConflictRow = mutation({
  args: {
    rowId: v.id("importedMembers"),
    note: v.optional(v.string()),
  },
  handler: async (
    ctx,
    args,
  ): Promise<
    | { ok: true; state: "conflict" }
    | { ok: false; error: "not_authorized" | "not_found" }
  > => {
    let adminEmail: string;
    try {
      adminEmail = await requireSuperAdmin(ctx);
    } catch {
      return { ok: false, error: "not_authorized" };
    }
    const row = await ctx.db.get(args.rowId);
    if (row === null || row.claim_state !== "conflict") {
      return { ok: false, error: "not_found" };
    }
    const note = (args.note ?? "").trim().slice(0, 200);
    const archiveNote =
      "archived as conflict (kept as trail, not claimable)" +
      (note.length > 0 ? ` (${note})` : "");
    await ctx.db.patch(row._id, {
      conflict_reason: appendNote(row.conflict_reason, archiveNote),
    });
    await writeAudit(ctx, {
      actor: adminEmail,
      role: "admin_fallback",
      action: "archiveConflictRow",
      target_id: row._id,
      before_summary: `claim_state=conflict`,
      after_summary: `claim_state=conflict archived=true`,
      source: "admin_fallback",
    });
    return { ok: true, state: "conflict" };
  },
});
