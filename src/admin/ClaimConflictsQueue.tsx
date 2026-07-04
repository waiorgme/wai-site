import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { muted } from "../portal/ui";
import { queueSection, queueTitle, rowCard, rowMeta, rowName, tag } from "./ui";

// Claim conflicts queue (spec criterion 2), read-only in this slice. Shows
// masked identity, reason, match signals and age. resolveConflictAsClaimed is
// NOT built (Open Question 1); suppressed_minor rows are read-only by design
// (no action forces a minor's row claimable early).

const reasonCopy: Record<string, string> = {
  duplicate_email: "Two records share this email; a human must decide which is real.",
  missing_legacy_number: "The legacy membership number is missing.",
  dob_mismatch_at_claim: "The date of birth given at claim did not match the record on file.",
};

export function ClaimConflictsQueue() {
  const rows = useQuery(api.admin.claims.listConflicts);

  return (
    <section style={queueSection}>
      <h2 style={queueTitle}>Claim conflicts</h2>
      {rows === undefined ? (
        <p style={muted}>Loading…</p>
      ) : rows.length === 0 ? (
        <p style={muted}>No rows waiting.</p>
      ) : (
        rows.map((row) => (
          <div key={row.rowId} style={rowCard}>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <p style={rowName}>{row.masked_name}</p>
              <span style={tag}>
                {row.claim_state === "conflict" ? "conflict" : "held (under 18)"}
              </span>
            </div>
            <p style={rowMeta}>
              {row.conflict_reason
                ? (reasonCopy[row.conflict_reason] ?? row.conflict_reason)
                : row.claim_state === "suppressed_minor"
                  ? "Held until the record shows she is 18. It clears on its own; no action needed here. Email her within 2 working days if contact is warranted."
                  : "Needs a human review."}
            </p>
            <p style={rowMeta}>
              Match signals: email {row.match_signals.email ? "yes" : "no"}, name{" "}
              {row.match_signals.name ? "yes" : "no"}, mobile{" "}
              {row.match_signals.mobile ? "yes" : "no"}, dob{" "}
              {row.match_signals.dob ? "yes" : "no"}. {row.days_since_change} day(s)
              in this state.
            </p>
            {row.claim_state === "conflict" && (
              <p style={{ ...rowMeta, opacity: 0.72 }}>
                Resolving a conflict is not yet available in the panel. It is
                paused until the resolution rule is signed off.
              </p>
            )}
          </div>
        ))
      )}
    </section>
  );
}
