import { v } from "convex/values";
import { mutation, query } from "../_generated/server";
import { requireAdmin } from "../lib/adminAuth";
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

// Criterion 2 (masked-surface rule) + Codex round 5: the queue NEVER returns raw
// emails to the browser. Grouping of duplicate-email rows is done SERVER-SIDE and
// exposed only as an OPAQUE per-query duplicate_group index (not derivable back to
// the email), with count/flag helpers the UI groups by. The actual email is
// revealed one row at a time, on deliberate demand, through revealContactEmail
// (audited), which is the "deliberate separate approval" the vault's no-bulk-PII
// rule requires and serves the wave-run ops routine's personal-email commitment.
export type ConflictRow = {
  rowId: string;
  masked_name: string;
  claim_state: "conflict" | "suppressed_minor" | "archived_conflict";
  conflict_reason: string | null;
  match_signals: { email: boolean; name: boolean; mobile: boolean; dob: boolean };
  days_since_change: number;
  // Opaque per-query group index shared by rows at the same email; not the email
  // and not derivable back to it. Rows with the same duplicate_group are a group.
  duplicate_group: number;
  // Live (conflict-state) siblings at this email, including this row.
  live_duplicate_count: number;
  // Whether any OTHER row (any state) shares this email: the archive-action gate.
  shares_email_with_other: boolean;
};

export const listConflicts = query({
  args: {},
  handler: async (ctx): Promise<ConflictRow[]> => {
    await requireAdmin(ctx);
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
    const all = [...conflicts, ...minors, ...archived];

    // Assign an opaque group index per distinct email, SERVER-SIDE. The email
    // itself never leaves the server; only the index does.
    const groupOf = new Map<string, number>();
    let nextGroup = 0;
    for (const row of all) {
      if (!groupOf.has(row.normalized_email)) {
        groupOf.set(row.normalized_email, nextGroup++);
      }
    }
    // Precompute per-email counts (live siblings, and any-state total).
    const liveByEmail = new Map<string, number>();
    const totalByEmail = new Map<string, number>();
    for (const row of all) {
      totalByEmail.set(
        row.normalized_email,
        (totalByEmail.get(row.normalized_email) ?? 0) + 1,
      );
      if (row.claim_state === "conflict") {
        liveByEmail.set(
          row.normalized_email,
          (liveByEmail.get(row.normalized_email) ?? 0) + 1,
        );
      }
    }

    return all.map((row) => ({
      rowId: row._id,
      masked_name: maskName(row.name),
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
      duplicate_group: groupOf.get(row.normalized_email) as number,
      live_duplicate_count: liveByEmail.get(row.normalized_email) ?? 0,
      shares_email_with_other:
        (totalByEmail.get(row.normalized_email) ?? 0) > 1,
    }));
  },
});

// revealContactEmail (criterion 2 + Codex round 5). The wave-run ops routine
// commits Mervat/Issam to personally EMAILING conflict / suppressed-minor
// members within 2 working days, so contact is operationally required. This is
// the ONE audited, per-row, deliberate reveal of a single row's email - the
// "deliberate, separate approval" the vault's no-bulk-PII rule requires. There
// is NO bulk variant. Propose-then-confirm in the UI; one row at a time.
export const revealContactEmail = mutation({
  args: { rowId: v.id("importedMembers") },
  handler: async (
    ctx,
    args,
  ): Promise<
    | { ok: true; email: string }
    | { ok: false; error: "not_authorized" | "not_found" }
  > => {
    let adminEmail: string;
    try {
      adminEmail = await requireAdmin(ctx);
    } catch {
      return { ok: false, error: "not_authorized" };
    }
    const row = await ctx.db.get(args.rowId);
    // Only rows this queue surfaces (a review-state row) can be revealed.
    if (
      row === null ||
      (row.claim_state !== "conflict" &&
        row.claim_state !== "suppressed_minor" &&
        row.claim_state !== "archived_conflict")
    ) {
      return { ok: false, error: "not_found" };
    }
    // §8 audit: row id only in the summary, never the revealed email itself.
    await writeAudit(ctx, {
      actor: adminEmail,
      role: "admin_fallback",
      action: "reveal_contact_email",
      target_id: row._id,
      after_summary: `contact email revealed for one row (claim_state=${row.claim_state})`,
      source: "admin_fallback",
    });
    return { ok: true, email: row.normalized_email };
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
      adminEmail = await requireAdmin(ctx);
    } catch {
      return { ok: false, error: "not_authorized" };
    }
    const row = await ctx.db.get(args.rowId);
    // Same neutral shape whether the row is missing or in the wrong state. An
    // archived_conflict row is NEVER releasable: the parked trail is permanent.
    if (row === null || row.claim_state !== "conflict") {
      return { ok: false, error: "not_found" };
    }

    const originalEmail = row.normalized_email;
    let targetEmail = originalEmail;
    if (args.correctedEmail !== undefined && args.correctedEmail.trim() !== "") {
      if (!isValidJoinEmail(args.correctedEmail)) {
        return { ok: false, error: "validation" };
      }
      const corrected = normalizeEmail(args.correctedEmail);
      if (corrected !== originalEmail) {
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

    const emailCorrected = targetEmail !== originalEmail;

    // A members row already owning the TARGET email makes the released row dead:
    // getMyClaimCandidate / matchClaim return "already a member, sign in" before
    // ever reading imported rows, so the "unclaimed" row would never be claimable.
    // Refuse (the reveal is not real). Check the target (corrected OR original).
    const memberAtTarget = await ctx.db
      .query("members")
      .withIndex("by_email", (q) => q.eq("email", targetEmail))
      .unique();
    if (memberAtTarget !== null) {
      return { ok: false, error: "email_collision" };
    }

    // Other rows still at the ORIGINAL email. Only the OTHER half of the
    // duplicate-CONFLICT (claim_state="conflict") may be auto-archived as part of
    // resolving this pair (correct + archive decision). Any OTHER live state
    // sharing the email - suppressed_minor (safeguarding: read-only, age-up only),
    // unclaimed, claim_in_progress, or claimed - is NOT part of this conflict and
    // must never be auto-parked: that situation needs human untangling, so we
    // refuse the release entirely and change nothing. archived_conflict rows are
    // the inert trail and are ignored.
    const atOriginal = await ctx.db
      .query("importedMembers")
      .withIndex("by_normalized_email", (q) =>
        q.eq("normalized_email", originalEmail),
      )
      .collect();
    const others = atOriginal.filter((r) => r._id !== row._id);
    const otherConflicts = others.filter((r) => r.claim_state === "conflict");
    const otherNonConflictLive = others.filter(
      (r) => r.claim_state !== "conflict" && isLiveRow(r.claim_state),
    );

    // A non-conflict live row sharing the email blocks automation whether or not
    // a correction was supplied when releasing at (or leaving at) that email.
    // Leaving a suppressed_minor/claimed row while archiving its neighbours (or
    // orphaning it) is exactly the over-reach to avoid: refuse.
    if (otherNonConflictLive.length > 0) {
      return { ok: false, error: "duplicate_unresolved" };
    }
    // Auto-archive is only safe for the TRUE pair case: EXACTLY ONE other
    // conflict row at the original email. With two or more, the admin identified
    // only one row as verified and cannot mean to park all the rest in a single
    // click - refuse so she resolves/archives each explicitly.
    if (otherConflicts.length > 1) {
      return { ok: false, error: "duplicate_unresolved" };
    }
    if (!emailCorrected && otherConflicts.length > 0) {
      // No correction: releasing would leave >1 live row at this email, which
      // matchClaim holds. Tell the admin to archive the other conflict first (or
      // supply a unique corrected email so this mutation can archive it).
      return { ok: false, error: "duplicate_unresolved" };
    }

    const note = (args.note ?? "").trim().slice(0, 200);
    const resolutionNote =
      `resolved by admin: released as verified` +
      (emailCorrected ? " with corrected email" : "") +
      (note.length > 0 ? ` (${note})` : "");

    // Atomic pair archive (only reachable when emailCorrected, since the
    // no-correction path refuses above): the other CONFLICT halves at the
    // original email become a permanent archived_conflict trail. Only conflict
    // rows are touched here.
    for (const other of otherConflicts) {
      await ctx.db.patch(other._id, {
        claim_state: "archived_conflict",
        conflict_reason: appendNote(
          other.conflict_reason,
          "archived as conflict (kept as trail, not claimable); pair released with corrected email",
        ),
      });
      await writeAudit(ctx, {
        actor: adminEmail,
        role: "admin_fallback",
        action: "archiveConflictRow",
        target_id: other._id,
        before_summary: `claim_state=conflict`,
        after_summary: `claim_state=archived_conflict note_present=true`,
        source: "admin_fallback",
      });
    }

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
      after_summary: `claim_state=unclaimed email_corrected=${emailCorrected} pair_archived=${otherConflicts.length} note_present=${note.length > 0}`,
      source: "admin_fallback",
    });
    return { ok: true, state: "unclaimed" };
  },
});

// archiveConflictRow (criterion 2, the other side of the decided mechanic). The
// non-matching row of a duplicate-email PAIR moves from `conflict` to
// `archived_conflict`: permanently parked, never claimable, never deleted (the
// archived row is the trail). matchClaim / getMyClaimCandidate ignore it, so its
// resolved pair can be claimed. Archiving is SCOPED to duplicate-email groups
// (Issam's correct+archive decision): a single conflict whose email is unique
// (e.g. a lone DOB-mismatch) is never permanently parked here - it stays in
// review until corrected or released. §8 audit: structured, PII-free.
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
    | { ok: false; error: "not_authorized" | "not_found" | "not_duplicate" }
  > => {
    let adminEmail: string;
    try {
      adminEmail = await requireAdmin(ctx);
    } catch {
      return { ok: false, error: "not_authorized" };
    }
    const row = await ctx.db.get(args.rowId);
    if (row === null || row.claim_state !== "conflict") {
      return { ok: false, error: "not_found" };
    }
    // Only the non-matching row of a duplicate-email group may be archived: there
    // must be at least one OTHER importedMembers row at the same normalized_email
    // (in any state - the pair may already be released or archived). A conflict
    // whose email is unique is not a duplicate and stays in review.
    const sameEmail = await ctx.db
      .query("importedMembers")
      .withIndex("by_normalized_email", (q) =>
        q.eq("normalized_email", row.normalized_email),
      )
      .collect();
    const hasOther = sameEmail.some((r) => r._id !== row._id);
    if (!hasOther) {
      return { ok: false, error: "not_duplicate" };
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
