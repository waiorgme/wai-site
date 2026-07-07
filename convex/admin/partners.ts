import { v } from "convex/values";
import { mutation, query } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { requireAdmin } from "../lib/adminAuth";
import { writeAudit } from "../lib/audit";
import { isValidJoinEmail, normalizeEmail } from "../lib/joinValidation";
import { isSafeHttpsUrl } from "../lib/url";

// Partners admin (panel-experience spec §G16; Corporate Membership handoff,
// Money Mechanism, Stage 0 §4.6). Partners are admin-managed RELATIONSHIP
// records: MOU outcome = tier, committed vs delivered deliverables, seal
// granted on signing and revocable. No corporate login, no payments, no
// binding contracts, no public exposure anywhere in this slice (the self-serve
// Partner Portal is the vault's own Phase 4/5 item; these shapes stay
// compatible). Every function is requireAdmin (deny-by-default); every
// write returns the §7.1 envelope and appends the §8 audit row. Partner names
// in audit summaries are fine: org data, not member PII.

const tierArg = v.union(
  v.literal("supporter"),
  v.literal("partner"),
  v.literal("champion"),
);

const statusArg = v.union(
  v.literal("prospect"),
  v.literal("active"),
  v.literal("lapsed"),
  v.literal("declined"),
);

const deliverableStatusArg = v.union(
  v.literal("committed"),
  v.literal("in_progress"),
  v.literal("delivered"),
  v.literal("part_delivered"),
);

const deliverableArg = v.object({
  label: v.string(),
  status: deliverableStatusArg,
});

type Deliverable = {
  label: string;
  status: "committed" | "in_progress" | "delivered" | "part_delivered";
};

const NAME_MAX = 160;
const TEXT_MAX = 2000;
const DEFAULT_TERM_MONTHS = 12;

export type PartnerListRow = {
  partnerId: Id<"partners">;
  name: string;
  tier: Doc<"partners">["tier"];
  status: Doc<"partners">["status"];
  seal: Doc<"partners">["seal"];
  contact_name: string | null;
  mou_signed_on: string | null;
  deliverables_total: number;
  deliverables_delivered: number;
  show_publicly: boolean;
  created_at: number;
};

export const listPartners = query({
  args: { status: v.optional(statusArg) },
  handler: async (ctx, args): Promise<PartnerListRow[]> => {
    await requireAdmin(ctx);
    const rows =
      args.status === undefined
        ? await ctx.db.query("partners").collect()
        : await ctx.db
            .query("partners")
            .withIndex("by_status", (q) =>
              q.eq("status", args.status as Doc<"partners">["status"]),
            )
            .collect();
    rows.sort((a, b) => b.created_at - a.created_at);
    return rows.map((p) => {
      const deliverables = p.deliverables ?? [];
      return {
        partnerId: p._id,
        name: p.name,
        tier: p.tier,
        status: p.status,
        seal: p.seal,
        contact_name: p.contact_name ?? null,
        mou_signed_on: p.mou_signed_on ?? null,
        deliverables_total: deliverables.length,
        deliverables_delivered: deliverables.filter(
          (d) => d.status === "delivered",
        ).length,
        show_publicly: p.show_publicly,
        created_at: p.created_at,
      };
    });
  },
});

export type PartnerDetail = {
  partnerId: Id<"partners">;
  name: string;
  tier: Doc<"partners">["tier"];
  status: Doc<"partners">["status"];
  contact_name: string | null;
  contact_email: string | null;
  website: string | null;
  mou_signed_on: string | null;
  term_months: number;
  committed_value: string | null;
  deliverables: Deliverable[];
  seal: Doc<"partners">["seal"];
  logo_url: string | null;
  show_publicly: boolean;
  notes: string | null;
  created_at: number;
};

export const getPartner = query({
  args: { partnerId: v.id("partners") },
  handler: async (ctx, args): Promise<PartnerDetail | null> => {
    await requireAdmin(ctx);
    const p = await ctx.db.get(args.partnerId);
    if (p === null) {
      return null;
    }
    const logo_url = p.logo_storage_id
      ? await ctx.storage.getUrl(p.logo_storage_id)
      : null;
    return {
      partnerId: p._id,
      name: p.name,
      tier: p.tier,
      status: p.status,
      contact_name: p.contact_name ?? null,
      contact_email: p.contact_email ?? null,
      website: p.website ?? null,
      mou_signed_on: p.mou_signed_on ?? null,
      term_months: p.term_months ?? DEFAULT_TERM_MONTHS,
      committed_value: p.committed_value ?? null,
      deliverables: p.deliverables ?? [],
      seal: p.seal,
      logo_url,
      show_publicly: p.show_publicly,
      notes: p.notes ?? null,
      created_at: p.created_at,
    };
  },
});

// Create or edit the relationship record from the full form state. Absent
// optional fields clear the stored value (the form always sends its complete
// state). Seal and logo are NOT writable here: they have their own audited
// actions below.
export const upsertPartner = mutation({
  args: {
    partnerId: v.optional(v.id("partners")),
    name: v.string(),
    tier: tierArg,
    status: statusArg,
    contact_name: v.optional(v.string()),
    contact_email: v.optional(v.string()),
    website: v.optional(v.string()),
    mou_signed_on: v.optional(v.string()),
    term_months: v.optional(v.number()),
    committed_value: v.optional(v.string()),
    deliverables: v.optional(v.array(deliverableArg)),
    show_publicly: v.optional(v.boolean()),
    notes: v.optional(v.string()),
  },
  handler: async (
    ctx,
    args,
  ): Promise<
    | { ok: true; partnerId: Id<"partners"> }
    | { ok: false; error: "not_authorized" | "not_found" | "validation" }
  > => {
    let adminEmail: string;
    try {
      adminEmail = await requireAdmin(ctx);
    } catch {
      return { ok: false, error: "not_authorized" };
    }
    const name = args.name.trim();
    if (name.length === 0 || name.length > NAME_MAX) {
      return { ok: false, error: "validation" };
    }
    let contactEmail: string | undefined;
    if (args.contact_email !== undefined && args.contact_email.trim() !== "") {
      if (!isValidJoinEmail(args.contact_email)) {
        return { ok: false, error: "validation" };
      }
      contactEmail = normalizeEmail(args.contact_email);
    }
    const termMonths = args.term_months ?? DEFAULT_TERM_MONTHS;
    if (!Number.isInteger(termMonths) || termMonths < 1 || termMonths > 120) {
      return { ok: false, error: "validation" };
    }
    const deliverables: Deliverable[] = args.deliverables ?? [];
    if (
      deliverables.some(
        (d) => d.label.trim().length === 0 || d.label.length > NAME_MAX,
      )
    ) {
      return { ok: false, error: "validation" };
    }
    // The website is a link the day any surface renders it: https only and
    // bounded, the same rule as event meeting/recording links. The remaining
    // free-text fields get honest caps - refused, never silently truncated.
    const website = args.website?.trim() || undefined;
    if (website !== undefined && !isSafeHttpsUrl(website)) {
      return { ok: false, error: "validation" };
    }
    if (
      (args.contact_name ?? "").length > NAME_MAX ||
      (args.committed_value ?? "").length > NAME_MAX ||
      (args.mou_signed_on ?? "").length > 40 ||
      (args.notes ?? "").length > TEXT_MAX
    ) {
      return { ok: false, error: "validation" };
    }
    const notes = args.notes?.trim() || undefined;

    const fields = {
      name,
      tier: args.tier,
      status: args.status,
      contact_name: args.contact_name?.trim() || undefined,
      contact_email: contactEmail,
      website,
      mou_signed_on: args.mou_signed_on?.trim() || undefined,
      term_months: termMonths,
      committed_value: args.committed_value?.trim() || undefined,
      deliverables,
      show_publicly: args.show_publicly ?? false,
      notes,
    };

    if (args.partnerId === undefined) {
      const partnerId = await ctx.db.insert("partners", {
        ...fields,
        seal: "none",
        created_at: Date.now(),
      });
      await writeAudit(ctx, {
        actor: adminEmail,
        role: "admin_fallback",
        action: "upsertPartner",
        target_id: partnerId,
        after_summary: `partner created: ${name} (tier=${args.tier} status=${args.status} deliverables=${deliverables.length})`,
        source: "admin_fallback",
      });
      return { ok: true, partnerId };
    }

    const existing = await ctx.db.get(args.partnerId);
    if (existing === null) {
      return { ok: false, error: "not_found" };
    }
    await ctx.db.patch(existing._id, fields);
    await writeAudit(ctx, {
      actor: adminEmail,
      role: "admin_fallback",
      action: "upsertPartner",
      target_id: existing._id,
      before_summary: `partner: ${existing.name} (tier=${existing.tier} status=${existing.status})`,
      after_summary: `partner updated: ${name} (tier=${args.tier} status=${args.status} deliverables=${deliverables.length})`,
      source: "admin_fallback",
    });
    return { ok: true, partnerId: existing._id };
  },
});

// One deliverable moves committed -> in_progress -> delivered/part_delivered
// (Money Mechanism: the committed-vs-delivered ledger; impact reports count
// only DELIVERED commitments). Audited with before/after.
export const setDeliverableStatus = mutation({
  args: {
    partnerId: v.id("partners"),
    index: v.number(),
    status: deliverableStatusArg,
  },
  handler: async (
    ctx,
    args,
  ): Promise<
    | { ok: true; already?: true }
    | { ok: false; error: "not_authorized" | "not_found" | "validation" }
  > => {
    let adminEmail: string;
    try {
      adminEmail = await requireAdmin(ctx);
    } catch {
      return { ok: false, error: "not_authorized" };
    }
    const partner = await ctx.db.get(args.partnerId);
    if (partner === null) {
      return { ok: false, error: "not_found" };
    }
    const deliverables = [...(partner.deliverables ?? [])];
    if (
      !Number.isInteger(args.index) ||
      args.index < 0 ||
      args.index >= deliverables.length
    ) {
      return { ok: false, error: "validation" };
    }
    const before = deliverables[args.index];
    if (before.status === args.status) {
      return { ok: true, already: true };
    }
    deliverables[args.index] = { label: before.label, status: args.status };
    await ctx.db.patch(partner._id, { deliverables });
    await writeAudit(ctx, {
      actor: adminEmail,
      role: "admin_fallback",
      action: "setDeliverableStatus",
      target_id: partner._id,
      before_summary: `${partner.name} deliverable[${args.index}] "${before.label}" status=${before.status}`,
      after_summary: `${partner.name} deliverable[${args.index}] "${before.label}" status=${args.status}`,
      source: "admin_fallback",
    });
    return { ok: true };
  },
});

// Seal granted on signing, withdrawn for bad faith; dated by the audit row.
// Consequences are reputational only, never enforcement (Money Mechanism).
export const setSeal = mutation({
  args: {
    partnerId: v.id("partners"),
    seal: v.union(v.literal("granted"), v.literal("withdrawn")),
  },
  handler: async (
    ctx,
    args,
  ): Promise<
    | { ok: true; already?: true }
    | { ok: false; error: "not_authorized" | "not_found" }
  > => {
    let adminEmail: string;
    try {
      adminEmail = await requireAdmin(ctx);
    } catch {
      return { ok: false, error: "not_authorized" };
    }
    const partner = await ctx.db.get(args.partnerId);
    if (partner === null) {
      return { ok: false, error: "not_found" };
    }
    if (partner.seal === args.seal) {
      return { ok: true, already: true };
    }
    await ctx.db.patch(partner._id, { seal: args.seal });
    await writeAudit(ctx, {
      actor: adminEmail,
      role: "admin_fallback",
      action: "setSeal",
      target_id: partner._id,
      before_summary: `${partner.name} seal=${partner.seal}`,
      after_summary: `${partner.name} seal=${args.seal}`,
      source: "admin_fallback",
    });
    return { ok: true };
  },
});

// Logo upload mirrors the member photo pattern (convex/members.ts): a
// short-lived upload URL, then the stored blob is validated server-side
// before it is linked. Admin-gated, envelope result.
export const generateLogoUploadUrl = mutation({
  args: {},
  handler: async (
    ctx,
  ): Promise<
    { ok: true; url: string } | { ok: false; error: "not_authorized" }
  > => {
    try {
      await requireAdmin(ctx);
    } catch {
      return { ok: false, error: "not_authorized" };
    }
    const url = await ctx.storage.generateUploadUrl();
    return { ok: true, url };
  },
});

export const setPartnerLogo = mutation({
  args: { partnerId: v.id("partners"), storageId: v.id("_storage") },
  handler: async (
    ctx,
    args,
  ): Promise<
    | { ok: true }
    | { ok: false; error: "not_authorized" | "not_found" | "validation" }
  > => {
    let adminEmail: string;
    try {
      adminEmail = await requireAdmin(ctx);
    } catch {
      return { ok: false, error: "not_authorized" };
    }
    const partner = await ctx.db.get(args.partnerId);
    if (partner === null) {
      return { ok: false, error: "not_found" };
    }
    // SEC-4 mirror: raster images only (no scriptable SVG), 5 MB cap; the
    // client's accept attribute is advisory.
    const blob = await ctx.db.system.get(args.storageId);
    if (blob === null) {
      return { ok: false, error: "validation" };
    }
    const allowed = ["image/jpeg", "image/png", "image/webp"];
    const type = blob.contentType ?? "";
    if (!allowed.includes(type) || blob.size > 5 * 1024 * 1024) {
      return { ok: false, error: "validation" };
    }
    await ctx.db.patch(partner._id, { logo_storage_id: args.storageId });
    await writeAudit(ctx, {
      actor: adminEmail,
      role: "admin_fallback",
      action: "setPartnerLogo",
      target_id: partner._id,
      after_summary: `${partner.name} logo updated`,
      source: "admin_fallback",
    });
    return { ok: true };
  },
});
