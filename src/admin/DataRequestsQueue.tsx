import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { hint, input, label, muted } from "../portal/ui";
import { ConfirmAction } from "./ConfirmAction";
import { queueSection, rowCard, rowMeta, rowName, tag } from "./ui";
import { plural } from "./views/shared";

// DataRequest admin queue (spec criterion 6, the buildable part). Lists
// submitted / identity_pending requests and lets the admin approve or reject
// with a required verification note. Fulfilment (export / erasure) is NOT built
// here (Open Question 2): approving records the decision only.

// Plain-language labels for the raw state enum (same pattern as reasonCopy in
// ClaimConflictsQueue), so the surface keeps its plain-language voice.
const stateLabel: Record<string, string> = {
  submitted: "New",
  identity_pending: "Checking identity",
};

// "Export" and "erasure" are GDPR words; the rows say what she actually asked
// for, in the page sub's own plain terms.
const kindTag: Record<"export" | "erasure", string> = {
  export: "Copy of her data",
  erasure: "Delete her data",
};

const kindPhrase: Record<"export" | "erasure", string> = {
  export: "for a copy of her data",
  erasure: "to delete her data",
};

export function DataRequestsQueue() {
  const rows = useQuery(api.admin.dataRequests.listDataRequests);
  const approve = useMutation(api.admin.dataRequests.approveDataRequest);

  return (
    <section className={queueSection}>
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
        <span className={`${tag} pn-tag--info`}>{kindTag[row.kind]}</span>
        <span className={tag}>{stateLabel[row.state] ?? row.state}</span>
      </div>
      <p className={rowMeta}>
        {row.linked_member_name
          ? `Linked to member: ${row.linked_member_name}.`
          : "No linked member on file."}{" "}
        Open {plural(row.days_open, "day", "days")}.
      </p>
      <p className={hint}>
        Approving records the decision only. Producing the export or carrying out
        the erasure is a separate step that is not yet available in the panel.
      </p>
      <div className="pn-actions">
        <ConfirmAction
          label="Approve"
          confirmLabel="Yes, approve"
          confirmDisabled={approveMethod.trim() === ""}
          summary={`Approve ${row.subject_email}'s request ${kindPhrase[row.kind]}. Record below how you confirmed the person's identity.`}
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
              : { ok: false, message: "That did not go through. Please try again." };
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
          confirmDisabled={rejectReason.trim() === ""}
          summary={`Reject ${row.subject_email}'s request ${kindPhrase[row.kind]}. Record below why.`}
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
              : { ok: false, message: "That did not go through. Please try again." };
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
