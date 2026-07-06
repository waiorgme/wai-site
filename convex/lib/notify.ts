import type { MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";

// §4.6 Notification writer (panel-experience slice). In-app channel only for
// now; the email channel is a recorded deferral until Resend Pro. Payloads are
// display-ready, plain-language, and PII-light (never another member's data).

export type NotificationType =
  | "event_rsvp"
  | "event_waitlist_promoted"
  | "event_update"
  | "application_received"
  | "application_result"
  | "certificate_issued"
  | "standing_change";

export const notify = async (
  ctx: MutationCtx,
  memberId: Id<"members">,
  type: NotificationType,
  title: string,
  body: string,
  href?: string,
): Promise<void> => {
  await ctx.db.insert("notifications", {
    member_id: memberId,
    type,
    title,
    body,
    href,
    channel: "in_app",
    read_at: undefined,
    created_at: Date.now(),
  });
};
