import { getAuthUserId } from "@convex-dev/auth/server";
import type { QueryCtx, MutationCtx, ActionCtx } from "../_generated/server";
import { internalQuery, query } from "../_generated/server";
import { internal } from "../_generated/api";

// Admin identity (spec criterion 1). A super admin is identified SERVER-SIDE by
// comparing the signed-in member's lower-cased email against a deployment env
// var (SUPER_ADMIN_EMAILS, comma-separated), set via `npx convex env set` on
// each deployment, never committed to the repo and never accepted as a
// client-supplied argument. This matches the TURNSTILE_SECRET_KEY / SITE_URL
// precedent. Deny-by-default (Stage 0 §3): an unset or empty allowlist means no
// one is admin, not "let anyone in."

// Pure allowlist logic, unit-tested: parse the comma-separated env value into a
// lower-cased, trimmed set and answer "is this email allowed". Case-insensitive
// on both sides; empty/unset denies; blank entries are ignored.
export const parseAllowlist = (raw: string | undefined): string[] => {
  if (raw === undefined) {
    return [];
  }
  return raw
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0);
};

export const isAllowedAdminEmail = (
  raw: string | undefined,
  email: string | null,
): boolean => {
  if (email === null || email === "") {
    return false;
  }
  const allow = parseAllowlist(raw);
  return allow.includes(email.trim().toLowerCase());
};

// The one neutral error every admin function returns/throws on failure, so a
// caller can never tell WHY it failed (wrong admin vs no such row vs wrong
// state), per criterion 10 and Stage 0 §7.1's named-error convention.
export const NOT_AUTHORIZED = "not_authorized" as const;

// Resolve the caller's MEMBER email from auth (never a client arg). Criterion 1
// authorizes the signed-in MEMBER, so we resolve through the members table (the
// existing by_userId / by_email pattern), not the raw auth-user row: an
// authenticated auth-user with no linked member row is not a member and is never
// an admin. Returns the member's lower-cased email, or null when there is no
// linked member (which the callers treat as deny).
const callerMemberEmail = async (
  ctx: QueryCtx | MutationCtx,
): Promise<string | null> => {
  const userId = await getAuthUserId(ctx);
  if (userId === null) {
    return null;
  }
  // Primary link: the member row carrying this userId (set at auth/link time).
  const byUserId = await ctx.db
    .query("members")
    .withIndex("by_userId", (q) => q.eq("userId", userId))
    .unique();
  if (byUserId !== null) {
    return byUserId.email.toLowerCase();
  }
  // Fallback: match by the auth-user's email to the members table, for a member
  // whose userId link has not been stamped yet. Still requires a real member
  // row: no member, no admin.
  const user = await ctx.db.get(userId);
  const authEmail = (user as { email?: string } | null)?.email;
  if (typeof authEmail !== "string") {
    return null;
  }
  const byEmail = await ctx.db
    .query("members")
    .withIndex("by_email", (q) => q.eq("email", authEmail.toLowerCase()))
    .unique();
  return byEmail === null ? null : byEmail.email.toLowerCase();
};

// Called FIRST in every SUPER-ADMIN-only function (certificates revoke/
// re-issue, erasure execution, config - the Stage 0 §3 super_admin extras).
// Returns the admin's email (the audit actor) on success; throws
// NOT_AUTHORIZED on any failure without revealing which check failed.
// Queries and mutations both use this; throwing (rather than returning an
// envelope) keeps the query contract per Stage 0 §7.1.
export const requireSuperAdmin = async (
  ctx: QueryCtx | MutationCtx,
): Promise<string> => {
  const email = await callerMemberEmail(ctx);
  if (!isAllowedAdminEmail(process.env.SUPER_ADMIN_EMAILS, email)) {
    throw new Error(NOT_AUTHORIZED);
  }
  // email is non-null here: isAllowedAdminEmail returned true.
  return email as string;
};

// Called FIRST in every ordinary admin-console function (queues, members,
// events, opportunities, partners, overview/reports, audit view). Stage 0 §3
// separates the roles: admin = Mervat + the named backup (ADMIN_EMAILS,
// same env-var mechanics as SUPER_ADMIN_EMAILS), super_admin = Issam, and a
// super admin can do everything an admin can. Deny-by-default holds: with
// BOTH env vars unset, no one passes.
export const requireAdmin = async (
  ctx: QueryCtx | MutationCtx,
): Promise<string> => {
  const email = await callerMemberEmail(ctx);
  if (
    !isAllowedAdminEmail(process.env.ADMIN_EMAILS, email) &&
    !isAllowedAdminEmail(process.env.SUPER_ADMIN_EMAILS, email)
  ) {
    throw new Error(NOT_AUTHORIZED);
  }
  return email as string;
};

// Actions have no `ctx.db`, so they cannot run the check directly. These
// internal queries do the same resolve-and-allowlist inside a query context;
// the action gates below call them. Throws NOT_AUTHORIZED on failure,
// returns the admin email on success.
export const resolveSuperAdmin = internalQuery({
  args: {},
  handler: async (ctx): Promise<string> => requireSuperAdmin(ctx),
});

export const resolveAdmin = internalQuery({
  args: {},
  handler: async (ctx): Promise<string> => requireAdmin(ctx),
});

// The action-side gates: same neutral throw for non-admins, same email on
// success. The guardian-resend action uses the admin tier.
export const requireSuperAdminInAction = async (
  ctx: ActionCtx,
): Promise<string> =>
  ctx.runQuery(internal.lib.adminAuth.resolveSuperAdmin, {});

export const requireAdminInAction = async (ctx: ActionCtx): Promise<string> =>
  ctx.runQuery(internal.lib.adminAuth.resolveAdmin, {});

// A non-throwing check the /admin page uses to decide between the queues and the
// neutral "not available" state. This is a courtesy for the UI ONLY: every
// admin query/mutation still calls requireAdmin/requireSuperAdmin server-side
// (criterion 1, deny-by-default). Returns false for a signed-out or
// non-allowlisted caller, never revealing the allowlist.
export const amISuperAdmin = query({
  args: {},
  handler: async (ctx): Promise<boolean> => {
    const email = await callerMemberEmail(ctx);
    return isAllowedAdminEmail(process.env.SUPER_ADMIN_EMAILS, email);
  },
});

// The UI-courtesy role probe: which console does this caller get? Every
// server function still runs its own gate; this only shapes what the UI
// offers (e.g. the Certificates view is super-admin only, spec F15).
export const myAdminRole = query({
  args: {},
  handler: async (ctx): Promise<"super_admin" | "admin" | null> => {
    const email = await callerMemberEmail(ctx);
    if (isAllowedAdminEmail(process.env.SUPER_ADMIN_EMAILS, email)) {
      return "super_admin";
    }
    if (isAllowedAdminEmail(process.env.ADMIN_EMAILS, email)) {
      return "admin";
    }
    return null;
  },
});
