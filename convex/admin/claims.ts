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
// Resolution mechanic DECIDED (Issam, 2026-07-04): correct + archive, refined in
// implementation (2026-07-04) with an `archived_conflict` claim_state so the
// released row can actually be claimed. The admin confirms which row is the
// verified person's and releases it back to `unclaimed` so it re-enters the
// NORMAL matchClaim path (no direct member linking, no shortcut past matchClaim's
// safeguards). Because matchClaim holds any email with more than one live
// imported row, release is only permitted when the target email is free of other
// live rows: either the admin supplies a unique corrected email, or she archives
// the other pair row first. archiveConflictRow moves the non-matching row from
// `conflict` to `archived_conflict` (permanent, never claimable, never deleted -
// the archived row is the trail), and matchClaim / getMyClaimCandidate exclude
// archived_conflict rows from duplicate counting.
//
// suppressed_minor rows stay read-only: they clear automatically when the record
// shows her 18 (existing importBatch logic), and no admin action forces a
// minor's row claimable early (that would bypass matchClaim's age gate).

const DAY_MS = 24 * 60 * 60 * 1000;

export type ConflictRow = {
  rowId: string;
  masked_name: string;
  normalized_email: string;
  claim_state: "conflict" | "suppressed_minor" | "archived_conflict";
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
    // archived_conflict rows stay visible read-only, so the trail of resolved
    // pairs is auditable in the queue itself.
    const archived = await ctx.db
      .query("importedMembers")
      .withIndex("by_claim_state", (q) => q.eq("claim_state", "archived_conflict"))
      .collect();
    return [...conflicts, ...minors, ...archived].map((row) => ({
      rowId: row._id,
      masked_name: maskName(row.name),
      normalized_email: row.normalized_email,
      claim_state: row.claim_state as
        | "conflict"
        | "suppressed_minor"
        | "archived_conflict",
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

// A live imported row is one matchClaim would still count toward a duplicate:
// anything except archived_conflict (which is the parked trail).
const isLiveRow = (state: string): boolean => state !== "archived_conflict";

// resolveConflictAsClaimed (criterion 2, decided mechanic). Confirms a
// `conflict` row as the verified person's row and RELEASES it to `unclaimed` so
// it re-enters the normal matchClaim path (never links a member directly). The
// release is only permitted when the TARGET email is free of any OTHER live
// imported row, because matchClaim holds any email with more than one live row:
// releasing into a still-ambiguous email would leave the row unclaimable. So the
// admin either supplies a unique corrected email (validated + lowercased/trimmed
// with the existing helpers) or archives the other pair row first; otherwise she
// gets `duplicate_unresolved` telling her to do that. The detailed resolution
// note stays on the ROW's conflict_reason (an operational field); the immutable
// §8 audit summary is structured and PII-free (row states + flags only).
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
    | {
        ok: false;
        error:
          | "not_authorized"
          | "not_found"
          | "validation"
          | "email_collision"
          | "duplicate_unresolved";
      }
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
    if (args.correctedEmail !== undefined && args.correctedEmail.trim() !== "") {
      if (!isValidJoinEmail(args.correctedEmail)) {
        return { ok: false, error: "validation" };
      }
      const corrected = normalizeEmail(args.correctedEmail);
      if (corrected !== row.normalized_email) {
        // Any OTHER live row at the corrected email blocks the correction
        // (releasing into an already active/claimable/conflicting email would
        // recreate the ambiguity we are resolving). archived_conflict rows do
        // not block: they are the parked trail matchClaim ignores.
        const atCorrected = await ctx.db
          .query("importedMembers")
          .withIndex("by_normalized_email", (q) =>
            q.eq("normalized_email", corrected),
          )
          .collect();
        const blocking = atCorrected.some(
          (r) => r._id !== row._id && isLiveRow(r.claim_state),
        );
        if (blocking) {
          return { ok: false, error: "email_collision" };
        }
      }
      targetEmail = corrected;
    }

    // The target email must be free of OTHER live rows, or matchClaim will hold
    // the released row. If the pair is still live at this email, refuse and tell
    // the admin to archive the other row (or supply a unique corrected email).
    const atTarget = await ctx.db
      .query("importedMembers")
      .withIndex("by_normalized_email", (q) =>
        q.eq("normalized_email", targetEmail),
      )
      .collect();
    const stillAmbiguous = atTarget.some(
      (r) => r._id !== row._id && isLiveRow(r.claim_state),
    );
    if (stillAmbiguous) {
      return { ok: false, error: "duplicate_unresolved" };
    }

    const emailCorrected = targetEmail !== row.normalized_email;
    const note = (args.note ?? "").trim().slice(0, 200);
    const resolutionNote =
      `resolved by admin: released as verified` +
      (emailCorrected ? " with corrected email" : "") +
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
      // Structured, PII-free: no raw note, no email in the summary.
      after_summary: `claim_state=unclaimed email_corrected=${emailCorrected} note_present=${note.length > 0}`,
      source: "admin_fallback",
    });
    return { ok: true, state: "unclaimed" };
  },
});

// archiveConflictRow (criterion 2, the other side of the decided mechanic). The
// non-matching row of a duplicate-email pair moves from `conflict` to
// `archived_conflict`: permanently parked, never claimable, never deleted (the
// archived row is the trail). matchClaim / getMyClaimCandidate ignore it, so its
// resolved pair can be claimed. §8 audit: structured, PII-free (states + flag).
export const archiveConflictRow = mutation({
  args: {
    rowId: v.id("importedMembers"),
    note: v.optional(v.string()),
  },
  handler: async (
    ctx,
    args,
  ): Promise<
    | { ok: true; state: "archived_conflict" }
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
      claim_state: "archived_conflict",
      conflict_reason: appendNote(row.conflict_reason, archiveNote),
    });
    await writeAudit(ctx, {
      actor: adminEmail,
      role: "admin_fallback",
      action: "archiveConflictRow",
      target_id: row._id,
      before_summary: `claim_state=conflict`,
      // Structured, PII-free: no raw note in the summary.
      after_summary: `claim_state=archived_conflict note_present=${note.length > 0}`,
      source: "admin_fallback",
    });
    return { ok: true, state: "archived_conflict" };
  },
});
