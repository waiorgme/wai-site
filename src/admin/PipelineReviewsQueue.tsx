import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { input, label, muted } from "../portal/ui";
import { ConfirmAction } from "./ConfirmAction";
import { queueSection, rowCard, rowMeta, rowName, tag } from "./ui";
import type { Lane } from "./views/shared";
import { fmtGstDate, LANE_WORDS, plural } from "./views/shared";

// Pipeline eligibility reviews queue (spec criterion 3). Each pending review can
// be approved or rejected; the decision calls the SAME logic the break-glass
// path uses, with the reviewer taken from the authenticated admin (never a
// free-text field). The panel can never approve a non-standard lane (server
// guard).

// Plain words for the raw consent_source enum (the same phrasing MemberDetail's
// consents list uses), so no database value sits mid-sentence.
const CONSENT_SOURCE_WORDS: Record<"join" | "claim" | "settings", string> = {
  join: "when she joined",
  claim: "while claiming her record",
  settings: "in her settings",
};

export function PipelineReviewsQueue() {
  const rows = useQuery(api.admin.pipelineReviews.listPendingReviews);
  const decide = useMutation(api.admin.pipelineReviews.decidePipelineReviewFromPanel);

  return (
    <section className={queueSection}>
      {rows === undefined ? (
        <p className={muted}>Loading…</p>
      ) : rows.length === 0 ? (
        <p className={muted}>No reviews waiting.</p>
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
    lane: Lane;
    days_open: number;
    consent_on_file: boolean;
    consent_date: number | null;
    consent_source: "join" | "claim" | "settings" | null;
  };
  decide: ReturnType<typeof useMutation<typeof api.admin.pipelineReviews.decidePipelineReviewFromPanel>>;
}) {
  // Approve and Reject keep separate note fields so one action's text can never
  // become the other's value (panel-design quirk fix, spec criterion 12 - the
  // same separate-fields invariant the other queues document).
  const [approveNote, setApproveNote] = useState("");
  const [rejectNote, setRejectNote] = useState("");
  return (
    <div className={rowCard}>
      <div className="pn-row-head">
        <p className={rowName}>{row.masked_name}</p>
        <span className={tag}>{LANE_WORDS[row.lane]}</span>
      </div>
      <p className={rowMeta}>
        Open {plural(row.days_open, "day", "days")}.{" "}
        {row.consent_on_file
          ? `She attested her details are accurate when she opted in${row.consent_source !== null ? ` (${CONSENT_SOURCE_WORDS[row.consent_source]}${row.consent_date !== null ? `, ${fmtGstDate(row.consent_date)}` : ""})` : ""}.`
          : "No attested consent is on record; approval is not available until she opts in."}
      </p>
      <div className="pn-actions">
        <ConfirmAction
          label="Approve"
          confirmLabel="Yes, approve"
          disabled={!row.consent_on_file}
          summary={`Approve this review. Approved partners will be able to find ${row.masked_name}'s profile. She is always introduced; her contact details are never shared directly.`}
          onConfirm={async () => {
            const res = await decide({
              reviewId: row.reviewId as never,
              decision: "approved",
              reason: approveNote.trim() === "" ? undefined : approveNote.trim(),
            });
            return res.ok
              ? { ok: true, message: "Approved. Her pipeline is now on." }
              : { ok: false, message: "That did not go through. Please try again." };
          }}
        >
          <label className={label}>
            Note (optional)
            <input
              className={input}
              value={approveNote}
              onChange={(e) => setApproveNote(e.target.value)}
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
              reason: rejectNote.trim() === "" ? undefined : rejectNote.trim(),
            });
            return res.ok
              ? { ok: true, message: "Rejected." }
              : { ok: false, message: "That did not go through. Please try again." };
          }}
        >
          <label className={label}>
            Note (optional)
            <input
              className={input}
              value={rejectNote}
              onChange={(e) => setRejectNote(e.target.value)}
              placeholder="Optional internal note"
            />
          </label>
        </ConfirmAction>
      </div>
    </div>
  );
}
