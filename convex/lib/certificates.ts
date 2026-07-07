import type { MutationCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { writeAudit } from "./audit";
import { notify } from "./notify";

// The membership certificate engine (MVP). Membership type auto-issues once,
// idempotently, when a member reaches `active`. The render template + assets are
// the confirmed design ([[02 Certificate Design & Eligibility Rules (Draft)]]).

export const CERT_TEMPLATE_VERSION = "membership-2026-06";

// PROVISIONAL numbering for new web sign-ups. Reconcile with the migrated 1,309
// members' existing numbers before launch (the claim-wave slice owns this).
const MEMBERSHIP_NUMBER_BASE = 2000;
// Early members carry the year-tagged "Founding Member" variant. Tunable; the
// real cutoff is an owner call before launch.
const FOUNDING_MEMBER_LIMIT = 5000;

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

// "12 June 2026" — formatted by hand (the Convex runtime's Intl is limited).
const formatDateLabel = (ts: number): string => {
  const d = new Date(ts);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
};

const nextMembershipNumber = async (ctx: MutationCtx): Promise<number> => {
  const row = await ctx.db
    .query("counters")
    .withIndex("by_name", (q) => q.eq("name", "membership_number"))
    .unique();
  if (row === null) {
    const first = MEMBERSHIP_NUMBER_BASE + 1;
    await ctx.db.insert("counters", { name: "membership_number", value: first });
    return first;
  }
  const next = row.value + 1;
  await ctx.db.patch(row._id, { value: next });
  return next;
};

// Issue the member's membership certificate. Idempotent: one per member, keyed
// on `membership:<memberId>`. Returns the certificate id (existing or new).
// Migrated members pass their LEGACY WAIME-### number (DATA-1: they keep it);
// new signups draw the next number from the counter, whose floor the import
// raises above every legacy number so the ranges never collide.
export const issueMembershipCertificate = async (
  ctx: MutationCtx,
  member: Doc<"members">,
  explicitNumber?: number,
): Promise<Id<"certificates">> => {
  const idempotency_key = `membership:${member._id}`;
  const existing = await ctx.db
    .query("certificates")
    .withIndex("by_idempotency_key", (q) =>
      q.eq("idempotency_key", idempotency_key),
    )
    .unique();
  if (existing !== null) {
    return existing._id;
  }

  const number = explicitNumber ?? (await nextMembershipNumber(ctx));
  const now = Date.now();
  // Unguessable public lookup key (128-bit). The WAIME-MEM-#### the member sees
  // is only a display label, never the verification key — so no one can walk the
  // sequential numbers to enumerate the membership list.
  const verify_token = crypto.randomUUID().replace(/-/g, "");
  const certId = await ctx.db.insert("certificates", {
    member_id: member._id,
    type: "membership",
    verify_token,
    membership_number: number,
    recipient_name: member.name,
    issued_at: now,
    issued_date_label: formatDateLabel(now),
    is_founding: number <= FOUNDING_MEMBER_LIMIT,
    status: "valid",
    template_version: CERT_TEMPLATE_VERSION,
    idempotency_key,
  });

  await writeAudit(ctx, {
    actor: member.email,
    role: "member",
    action: "issueMembershipCertificate",
    target_id: member._id,
    after_summary: `cert=WAIME-MEM-${number} number=${number}`,
    source: "system",
  });

  // Spec E12: certificate issued = notification, on EVERY issuance path
  // (activation, migrated claim, guardian confirmation, the fallback
  // mutation) - it lives here, past the idempotency return, so it fires
  // exactly once per real issuance (Gate 4 round 4).
  await notify(
    ctx,
    member._id,
    "certificate_issued",
    "Your membership certificate is ready",
    "Your WAI-ME membership certificate has been issued. Open your dashboard to view and share it.",
    "/portal",
  );

  return certId;
};
