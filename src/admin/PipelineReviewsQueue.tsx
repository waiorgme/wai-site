import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { input, label, muted } from "../portal/ui";
import { ConfirmAction } from "./ConfirmAction";
import { queueSection, queueTitle, rowCard, rowMeta, rowName, tag } from "./ui";

// Pipeline eligibility reviews queue (spec criterion 3). Each pending review can
// be approved or rejected; the decision calls the SAME logic the break-glass
// path uses, with the reviewer taken from the authenticated admin (never a
// free-text field). The panel can never approve a non-standard lane (server
// guard).

export function PipelineReviewsQueue() {
  const rows = useQuery(api.admin.pipelineReviews.listPendingReviews);
  const decide = useMutation(api.admin.pipelineReviews.decidePipelineReviewFromPanel);

  return (
    <section style={queueSection}>
      <h2 style={queueTitle}>Pipeline eligibility reviews</h2>
      {rows === undefined ? (
        <p style={muted}>Loading…</p>
      ) : rows.length === 0 ? (
        <p style={muted}>No reviews waiting.</p>
      ) : (
        rows.map((row) => (
          <ReviewRow key={row.reviewId} row={row} decide={decide} />
        ))
      )}
    </section>
  );
}

function ReviewRow({
  row,
  decide,
}: {
  row: {
    reviewId: string;
    masked_name: string;
    lane: string;
    days_open: number;
    consent_on_file: boolean;
    consent_date: number | null;
    consent_source: "join" | "claim" | "settings" | null;
  };
  decide: ReturnType<typeof useMutation<typeof api.admin.pipelineReviews.decidePipelineReviewFromPanel>>;
}) {
  const [reason, setReason] = useState("");
  return (
    <div style={rowCard}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <p style={rowName}>{row.masked_name}</p>
        <span style={tag}>lane: {row.lane}</span>
      </div>
      <p style={rowMeta}>
        Open {row.days_open} day(s).{" "}
        {row.consent_on_file
          ? `She attested her details are accurate when she opted in (${row.consent_source}${row.consent_date !== null ? `, ${new Date(row.consent_date).toLocaleDateString()}` : ""}).`
          : "No attested consent is on record; approval is not available until she opts in."}
      </p>
      <div style={{ display: "flex", gap: 18, flexWrap: "wrap" }}>
        <ConfirmAction
          label="Approve"
          confirmLabel="Yes, approve"
          disabled={!row.consent_on_file}
          summary={`Approve this review. Approved partners will be able to find ${row.masked_name}'s profile. She is always introduced; her contact details are never shared directly.`}
          onConfirm={async () => {
            const res = await decide({
              reviewId: row.reviewId as never,
              decision: "approved",
              reason: reason.trim() === "" ? undefined : reason.trim(),
            });
            return res.ok
              ? { ok: true, message: "Approved. Her pipeline is now on." }
              : { ok: false, message: "That could not be completed." };
          }}
        >
          <label style={label}>
            Note (optional)
            <input
              style={input}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Optional internal note"
            />
          </label>
        </ConfirmAction>
        <ConfirmAction
          label="Reject"
          confirmLabel="Yes, reject"
          summary={`Reject this review. ${row.masked_name}'s profile will not be shared with partners.`}
          onConfirm={async () => {
            const res = await decide({
              reviewId: row.reviewId as never,
              decision: "rejected",
              reason: reason.trim() === "" ? undefined : reason.trim(),
            });
            return res.ok
              ? { ok: true, message: "Rejected." }
              : { ok: false, message: "That could not be completed." };
          }}
        >
          <label style={label}>
            Note (optional)
            <input
              style={input}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Optional internal note"
            />
          </label>
        </ConfirmAction>
      </div>
    </div>
  );
}
