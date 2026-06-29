import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { mutation, query } from "./_generated/server";
import { issueMembershipCertificate } from "./lib/certificates";

// What a certificate row exposes for display (no internal ids).
const toView = (c: {
  type: "membership";
  public_id: string;
  membership_number: number;
  recipient_name: string;
  issued_date_label: string;
  is_founding: boolean;
}) => ({
  type: c.type,
  public_id: c.public_id,
  membership_number: c.membership_number,
  recipient_name: c.recipient_name,
  issued_date_label: c.issued_date_label,
  is_founding: c.is_founding,
});

// The signed-in member's certificates (for the dashboard).
export const getMyCertificates = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      return [];
    }
    const member = await ctx.db
      .query("members")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .unique();
    if (member === null) {
      return [];
    }
    const certs = await ctx.db
      .query("certificates")
      .withIndex("by_member", (q) => q.eq("member_id", member._id))
      .collect();
    return certs.map(toView);
  },
});

// Public verification: anyone with the link can confirm a certificate is real
// and see what it states. The page is the proof, not the image. No auth.
export const getCertificateByPublicId = query({
  args: { publicId: v.string() },
  handler: async (ctx, { publicId }) => {
    const cert = await ctx.db
      .query("certificates")
      .withIndex("by_public_id", (q) => q.eq("public_id", publicId))
      .unique();
    return cert === null ? null : toView(cert);
  },
});

// Idempotently ensure the signed-in active member has her membership
// certificate. Belt-and-suspenders with the auth-hook issuance: covers members
// who became active before this engine existed (and the future claim path).
export const ensureMyMembershipCertificate = mutation({
  args: {},
  handler: async (ctx): Promise<{ ok: boolean; public_id?: string }> => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      return { ok: false };
    }
    const member = await ctx.db
      .query("members")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .unique();
    // Only issue once the membership is real (email verified → active+).
    if (member === null || member.lifecycle_state === "email_unverified") {
      return { ok: false };
    }
    const certId = await issueMembershipCertificate(ctx, member);
    const cert = await ctx.db.get(certId);
    return { ok: true, public_id: cert?.public_id };
  },
});
