import { useAction, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { muted } from "../portal/ui";
import { ConfirmAction } from "./ConfirmAction";
import { queueSection, queueTitle, rowCard, rowMeta, rowName, tag } from "./ui";

// Pending guardians queue (spec criterion 4). Read-and-nudge only: the single
// action resends the guardian email through the member's own send path. There
// is deliberately NO control that confirms consent; a guardian's own button
// press on /guardian-confirm remains the only route to confirmed.

const formatSent = (ts: number | null): string =>
  ts === null ? "not sent yet" : new Date(ts).toLocaleDateString();

// Plain-language labels for the raw confirmation_state enum (same pattern as
// reasonCopy in ClaimConflictsQueue), so the surface keeps its plain-language
// voice.
const stateLabel: Record<string, string> = {
  pending: "waiting",
  expired: "link expired",
};

// Tag tone: an expired link needs attention (err); waiting stays neutral.
const stateTagClass: Record<string, string> = {
  pending: tag,
  expired: `${tag} pn-tag--err`,
};

export function PendingGuardiansQueue() {
  const rows = useQuery(api.admin.guardians.listPendingGuardians);
  const resend = useAction(api.guardians.resendGuardianEmailFromPanel);

  return (
    <section className={queueSection}>
      <h2 className={queueTitle}>Pending guardians</h2>
      {rows === undefined ? (
        <p className={muted}>Loading…</p>
      ) : rows.length === 0 ? (
        <p className={muted}>No guardian confirmations waiting.</p>
      ) : (
        rows.map((row) => (
          <div key={row.consentId} className={rowCard}>
            <div className="pn-row-head">
              <p className={rowName}>{row.member_first_name} (under 18)</p>
              <span className={stateTagClass[row.confirmation_state] ?? tag}>
                {stateLabel[row.confirmation_state] ?? row.confirmation_state}
              </span>
            </div>
            <p className={rowMeta}>
              Guardian: {row.masked_guardian_name}. Last email:{" "}
              {formatSent(row.token_sent_at)}. Waiting {row.days_waiting} day(s).
            </p>
            <ConfirmAction
              label="Resend the guardian email"
              confirmLabel="Yes, resend"
              summary={`Send the confirmation email again to ${row.member_first_name}'s guardian. This only resends the link; it does not confirm anything. Only the guardian's own button press confirms.`}
              onConfirm={async () => {
                const res = await resend({ memberId: row.memberId as never });
                if (res.ok) {
                  return { ok: true, message: "Sent. The guardian can check their inbox." };
                }
                const message =
                  res.error === "rate_limited"
                    ? "That email was sent recently. Please wait before sending it again."
                    : res.error === "not_eligible"
                      ? "This member is not waiting on a guardian right now."
                      : "The email could not be sent just now. Please try again later.";
                return { ok: false, message };
              }}
            />
          </div>
        ))
      )}
    </section>
  );
}
