import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { mutation, query } from "./_generated/server";
import { issueMembershipCertificate } from "./lib/certificates";

// What a certificate row exposes for display (no internal ids). verify_token is
// the unguessable key the holder uses to build her own share/verify link; the
// human label WAIME-MEM-#### is derived from the membership number on the client.
const toView = (c: {
  type: "membership";
  verify_token: string;
  membership_number: number;
  recipient_name: string;
  issued_date_label: string;
  is_founding: boolean;
  status: "valid" | "superseded" | "revoked";
}) => ({
  type: c.type,
  verify_token: c.verify_token,
  membership_number: c.membership_number,
  recipient_name: c.recipient_name,
  issued_date_label: c.issued_date_label,
  is_founding: c.is_founding,
  status: c.status,
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

// Public verification: anyone with the unguessable token can confirm a
// certificate and see its real status. The page is the proof, not the image.
// No auth, but the token can't be guessed, so the member list can't be walked.
export const getCertificateByToken = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const cert = await ctx.db
      .query("certificates")
      .withIndex("by_verify_token", (q) => q.eq("verify_token", token))
      .unique();
    return cert === null ? null : toView(cert);
  },
});

// Idempotently ensure the signed-in active member has her membership
// certificate. Belt-and-suspenders with the auth-hook issuance: covers members
// who became active before this engine existed (and the future claim path).
export const ensureMyMembershipCertificate = mutation({
  args: {},
  handler: async (ctx): Promise<{ ok: boolean; verify_token?: string }> => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      return { ok: false };
    }
    const member = await ctx.db
      .query("members")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .unique();
    // Only `active` members get a membership certificate. Minors sit at
    // `pending_guardian` until guardian consent, so they do not get one yet
    // (safeguarding); other pre-active states don't either.
    if (member === null || member.lifecycle_state !== "active") {
      return { ok: false };
    }
    const certId = await issueMembershipCertificate(ctx, member);
    const cert = await ctx.db.get(certId);
    return { ok: true, verify_token: cert?.verify_token };
  },
});
