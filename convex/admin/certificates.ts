import { v } from "convex/values";
import { mutation, query } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { requireSuperAdmin } from "../lib/adminAuth";
import { writeAudit } from "../lib/audit";
import { notify } from "../lib/notify";

// Certificates admin (panel-experience spec §F/criterion 15). Revoke and
// re-issue are reserved to SUPER_ADMIN per the vault ([[02 Certificates -
// In-House Engine (Decision)]] §6b, Admin Roles decision): records are
// archived (status flips), NEVER hard-deleted, and the public verification
// page tells the truth for every token: valid / superseded / revoked / not
// found. The re-issue correction flow is the decided supersedes chain: the
// old row goes `superseded`, a NEW row (same member and membership number,
// corrected name, fresh verify token) goes `valid` with supersedes_id
// pointing back. Every write returns the §7.1 envelope + a §8 audit row.

// Local mirror of lib/certificates.ts formatDateLabel (not exported there;
// shared libs are frozen for this slice). "12 June 2026", UTC.
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const formatDateLabel = (ts: number): string => {
  const d = new Date(ts);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
};

const NAME_MAX = 120;
const REASON_MAX = 140;

export type CertificateAdminRow = {
  certificateId: Id<"certificates">;
  recipient_name: string;
  membership_number: number;
  status: Doc<"certificates">["status"];
  issued_date_label: string;
  is_founding: boolean;
  memberId: Id<"members">;
};

export const listCertificates = query({
  args: {
    status: v.optional(
      v.union(
        v.literal("valid"),
        v.literal("superseded"),
        v.literal("revoked"),
      ),
    ),
    search: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<CertificateAdminRow[]> => {
    await requireSuperAdmin(ctx);
    const all = await ctx.db.query("certificates").collect();
    const needle = (args.search ?? "").trim().toLowerCase();
    const filtered = all.filter((c) => {
      if (args.status !== undefined && c.status !== args.status) {
        return false;
      }
      if (needle === "") {
        return true;
      }
      return (
        c.recipient_name.toLowerCase().includes(needle) ||
        String(c.membership_number).includes(needle)
      );
    });
    filtered.sort((a, b) => b.issued_at - a.issued_at);
    return filtered.map((c) => ({
      certificateId: c._id,
      recipient_name: c.recipient_name,
      membership_number: c.membership_number,
      status: c.status,
      issued_date_label: c.issued_date_label,
      is_founding: c.is_founding,
      memberId: c.member_id,
    }));
  },
});

// Revoke-with-reason: valid -> revoked. The row stays forever (the archived
// record IS the trail) and the public verification page starts answering
// "revoked" for its token. Idempotent: revoking an already revoked
// certificate is already done; a superseded one is not revocable (the live
// row in its chain is the one to act on).
export const revokeCertificate = mutation({
  args: { certificateId: v.id("certificates"), reason: v.string() },
  handler: async (
    ctx,
    args,
  ): Promise<
    | { ok: true; already?: true }
    | {
        ok: false;
        error: "not_authorized" | "not_found" | "validation" | "ineligible";
      }
  > => {
    let adminEmail: string;
    try {
      adminEmail = await requireSuperAdmin(ctx);
    } catch {
      return { ok: false, error: "not_authorized" };
    }
    const reason = args.reason.trim();
    if (reason.length === 0) {
      return { ok: false, error: "validation" };
    }
    const cert = await ctx.db.get(args.certificateId);
    if (cert === null) {
      return { ok: false, error: "not_found" };
    }
    if (cert.status === "revoked") {
      return { ok: true, already: true };
    }
    if (cert.status !== "valid") {
      return { ok: false, error: "ineligible" };
    }
    await ctx.db.patch(cert._id, { status: "revoked" });
    // The reason is the admin's operational wording (the vault requires
    // revoke-with-reason recorded); bounded, and never member contact data.
    await writeAudit(ctx, {
      actor: adminEmail,
      role: "admin_fallback",
      action: "revokeCertificate",
      target_id: cert._id,
      before_summary: `cert=WAIME-MEM-${cert.membership_number} status=valid`,
      after_summary: `cert=WAIME-MEM-${cert.membership_number} status=revoked reason="${reason.slice(0, REASON_MAX)}"`,
      source: "admin_fallback",
    });
    return { ok: true };
  },
});

// The decided correction flow (PRD §7.6 acceptance): old -> superseded, NEW
// row same member + membership number with the corrected recipient name, a
// fresh verify token and idempotency key, supersedes_id = old, is_founding
// carried, status valid. Both rows stay archived forever; both tokens answer
// honestly on the public verification page. The member is told her corrected
// certificate is ready.
export const reissueCertificate = mutation({
  args: { certificateId: v.id("certificates"), correctedName: v.string() },
  handler: async (
    ctx,
    args,
  ): Promise<
    | { ok: true; newCertificateId: Id<"certificates"> }
    | {
        ok: false;
        error: "not_authorized" | "not_found" | "validation" | "ineligible";
      }
  > => {
    let adminEmail: string;
    try {
      adminEmail = await requireSuperAdmin(ctx);
    } catch {
      return { ok: false, error: "not_authorized" };
    }
    const correctedName = args.correctedName.trim();
    if (correctedName.length === 0 || correctedName.length > NAME_MAX) {
      return { ok: false, error: "validation" };
    }
    const cert = await ctx.db.get(args.certificateId);
    if (cert === null) {
      return { ok: false, error: "not_found" };
    }
    // Only the live (valid) row of a chain can be corrected: a superseded row
    // already has a successor and a revoked one was pulled deliberately.
    if (cert.status !== "valid") {
      return { ok: false, error: "ineligible" };
    }

    const now = Date.now();
    await ctx.db.patch(cert._id, { status: "superseded" });
    // Fresh unguessable token (the lib/certificates.ts issuance idiom); the
    // idempotency key is deterministic on the superseded row, so the same
    // correction can never mint two successors.
    const verify_token = crypto.randomUUID().replace(/-/g, "");
    const newCertificateId = await ctx.db.insert("certificates", {
      member_id: cert.member_id,
      type: cert.type,
      verify_token,
      membership_number: cert.membership_number,
      recipient_name: correctedName,
      issued_at: now,
      issued_date_label: formatDateLabel(now),
      is_founding: cert.is_founding,
      status: "valid",
      supersedes_id: cert._id,
      template_version: cert.template_version,
      idempotency_key: `membership:${cert.member_id}:supersedes:${cert._id}`,
    });

    // §8 audit: the corrected NAME stays off the summary (member PII); the
    // chain itself is the record of what changed.
    await writeAudit(ctx, {
      actor: adminEmail,
      role: "admin_fallback",
      action: "reissueCertificate",
      target_id: cert._id,
      before_summary: `cert=WAIME-MEM-${cert.membership_number} status=valid`,
      after_summary: `cert=WAIME-MEM-${cert.membership_number} status=superseded; new cert issued (status=valid, supersedes chain set, name corrected)`,
      source: "admin_fallback",
    });
    await notify(
      ctx,
      cert.member_id,
      "certificate_issued",
      "Your corrected certificate is ready.",
      "We fixed the name on your membership certificate and issued a fresh copy. The new certificate is valid now; the old link will show it was superseded.",
      "/portal",
    );
    return { ok: true, newCertificateId };
  },
});
