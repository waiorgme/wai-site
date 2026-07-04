import { query } from "../_generated/server";
import { requireSuperAdmin } from "../lib/adminAuth";
import { maskName } from "../lib/adminMask";

// Admin pending-guardians queue (spec criterion 4, and the visibility handed to
// this slice by specs/guardian-consent.spec.md "Out of scope, recorded"). Lists
// guardianConsents in `pending` / `expired` for the two super admins, so they
// can see who is waiting and nudge (resend) - never confirm. No guardian PII
// beyond a masked name (§8's PII-minimisation applies to admin read surfaces
// too): the full guardian email is never returned.
//
// The only action is resendGuardianEmailFromPanel (in convex/guardians.ts,
// reusing the member's own send path). There is deliberately NO listed action
// that sets confirmation_state = confirmed.

const DAY_MS = 24 * 60 * 60 * 1000;

export type PendingGuardianRow = {
  consentId: string;
  memberId: string;
  member_first_name: string;
  member_lane: "minor" | "standard" | "ally" | "restricted_unknown";
  masked_guardian_name: string;
  confirmation_state: "pending" | "expired";
  token_sent_at: number | null;
  days_waiting: number;
};

export const listPendingGuardians = query({
  args: {},
  handler: async (ctx): Promise<PendingGuardianRow[]> => {
    await requireSuperAdmin(ctx);
    const now = Date.now();
    const pending = await ctx.db.query("guardianConsents").collect();
    const rows: PendingGuardianRow[] = [];
    for (const consent of pending) {
      if (
        consent.confirmation_state !== "pending" &&
        consent.confirmation_state !== "expired"
      ) {
        continue;
      }
      const member = await ctx.db.get(consent.member_id);
      if (member === null) {
        continue;
      }
      rows.push({
        consentId: consent._id,
        memberId: member._id,
        // First name only for the member (lane confirmation is `minor`).
        member_first_name: member.name.split(" ")[0] ?? "(unnamed)",
        member_lane: member.member_lane,
        masked_guardian_name: maskName(consent.guardian_name),
        confirmation_state: consent.confirmation_state,
        token_sent_at: consent.token_sent_at ?? null,
        days_waiting: Math.floor((now - consent._creationTime) / DAY_MS),
      });
    }
    return rows;
  },
});
