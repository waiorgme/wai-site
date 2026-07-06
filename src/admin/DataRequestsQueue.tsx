import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { hint, input, label, muted } from "../portal/ui";
import { ConfirmAction } from "./ConfirmAction";
import { queueSection, queueTitle, rowCard, rowMeta, rowName, tag } from "./ui";

// DataRequest admin queue (spec criterion 6, the buildable part). Lists
// submitted / identity_pending requests and lets the admin approve or reject
// with a required verification note. Fulfilment (export / erasure) is NOT built
// here (Open Question 2): approving records the decision only.

// Plain-language labels for the raw state enum (same pattern as reasonCopy in
// ClaimConflictsQueue), so the surface keeps its plain-language voice.
const stateLabel: Record<string, string> = {
  submitted: "new",
  identity_pending: "checking identity",
};

export function DataRequestsQueue() {
  const rows = useQuery(api.admin.dataRequests.listDataRequests);
  const approve = useMutation(api.admin.dataRequests.approveDataRequest);

  return (
    <section className={queueSection}>
      <h2 className={queueTitle}>Data requests</h2>
      {rows === undefined ? (
        <p className={muted}>Loading…</p>
      ) : rows.length === 0 ? (
        <p className={muted}>No data requests waiting.</p>
      ) : (
        rows.map((row) => (
          <DataRequestRow key={row.requestId} row={row} approve={approve} />
        ))
      )}
    </section>
  );
}

function DataRequestRow({
  row,
  approve,
}: {
  row: {
    requestId: string;
    subject_email: string;
    kind: "export" | "erasure";
    state: string;
    linked_member_name: string | null;
    days_open: number;
  };
  approve: ReturnType<typeof useMutation<typeof api.admin.dataRequests.approveDataRequest>>;
}) {
  // Approve and Reject keep separate fields so text typed under one can never
  // silently become the other's value.
  const [approveMethod, setApproveMethod] = useState("");
  const [rejectReason, setRejectReason] = useState("");
  return (
    <div className={rowCard}>
      <div className="pn-row-head">
        <p className={rowName}>{row.subject_email}</p>
        <span className={`${tag} pn-tag--info`}>{row.kind}</span>
        <span className={tag}>{stateLabel[row.state] ?? row.state}</span>
      </div>
      <p className={rowMeta}>
        {row.linked_member_name
          ? `Linked to member: ${row.linked_member_name}.`
          : "No linked member on file."}{" "}
        Open {row.days_open} day(s).
      </p>
      <p className={hint}>
        Approving records the decision only. Producing the export or carrying out
        the erasure is a separate step that is not yet available in the panel.
      </p>
      <div className="pn-actions">
        <ConfirmAction
          label="Approve"
          confirmLabel="Yes, approve"
          disabled={false}
          summary={`Approve this ${row.kind} request for ${row.subject_email}. Record below how you confirmed the person's identity.`}
          onConfirm={async () => {
            if (approveMethod.trim().length === 0) {
              return { ok: false, message: "Add how identity was confirmed first." };
            }
            const res = await approve({
              requestId: row.requestId as never,
              decision: "approved",
              verification_method: approveMethod.trim(),
            });
            return res.ok
              ? { ok: true, message: "Approved and recorded." }
              : { ok: false, message: "That could not be completed." };
          }}
        >
          <label className={label}>
            How was identity confirmed? (required)
            <input
              className={input}
              value={approveMethod}
              onChange={(e) => setApproveMethod(e.target.value)}
              placeholder="e.g. confirmed by reply from the email on file"
            />
          </label>
        </ConfirmAction>
        <ConfirmAction
          label="Reject"
          confirmLabel="Yes, reject"
          summary={`Reject this ${row.kind} request for ${row.subject_email}. Record below why.`}
          onConfirm={async () => {
            if (rejectReason.trim().length === 0) {
              return { ok: false, message: "Add a short note first." };
            }
            const res = await approve({
              requestId: row.requestId as never,
              decision: "rejected",
              verification_method: rejectReason.trim(),
            });
            return res.ok
              ? { ok: true, message: "Rejected and recorded." }
              : { ok: false, message: "That could not be completed." };
          }}
        >
          <label className={label}>
            Reason (required)
            <input
              className={input}
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="e.g. could not confirm identity"
            />
          </label>
        </ConfirmAction>
      </div>
    </div>
  );
}
