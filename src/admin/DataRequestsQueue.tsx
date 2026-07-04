import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { input, label, muted } from "../portal/ui";
import { ConfirmAction } from "./ConfirmAction";
import { queueSection, queueTitle, rowCard, rowMeta, rowName, tag } from "./ui";

// DataRequest admin queue (spec criterion 6, the buildable part). Lists
// submitted / identity_pending requests and lets the admin approve or reject
// with a required verification note. Fulfilment (export / erasure) is NOT built
// here (Open Question 2): approving records the decision only.

export function DataRequestsQueue() {
  const rows = useQuery(api.admin.dataRequests.listDataRequests);
  const approve = useMutation(api.admin.dataRequests.approveDataRequest);

  return (
    <section style={queueSection}>
      <h2 style={queueTitle}>Data requests</h2>
      {rows === undefined ? (
        <p style={muted}>Loading…</p>
      ) : rows.length === 0 ? (
        <p style={muted}>No data requests waiting.</p>
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
  const [method, setMethod] = useState("");
  const noteValid = method.trim().length > 0;
  return (
    <div style={rowCard}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <p style={rowName}>{row.subject_email}</p>
        <span style={tag}>{row.kind}</span>
        <span style={tag}>{row.state}</span>
      </div>
      <p style={rowMeta}>
        {row.linked_member_name
          ? `Linked to member: ${row.linked_member_name}.`
          : "No linked member on file."}{" "}
        Open {row.days_open} day(s).
      </p>
      <p style={{ ...rowMeta, opacity: 0.72 }}>
        Approving records the decision only. Producing the export or carrying out
        the erasure is a separate step that is not yet available in the panel.
      </p>
      <div style={{ display: "flex", gap: 18, flexWrap: "wrap" }}>
        <ConfirmAction
          label="Approve"
          confirmLabel="Yes, approve"
          disabled={false}
          summary={`Approve this ${row.kind} request for ${row.subject_email}. Record below how you confirmed the person's identity.`}
          onConfirm={async () => {
            if (!noteValid) {
              return { ok: false, message: "Add how identity was confirmed first." };
            }
            const res = await approve({
              requestId: row.requestId as never,
              decision: "approved",
              verification_method: method.trim(),
            });
            return res.ok
              ? { ok: true, message: "Approved and recorded." }
              : { ok: false, message: "That could not be completed." };
          }}
        >
          <label style={label}>
            How was identity confirmed? (required)
            <input
              style={input}
              value={method}
              onChange={(e) => setMethod(e.target.value)}
              placeholder="e.g. confirmed by reply from the email on file"
            />
          </label>
        </ConfirmAction>
        <ConfirmAction
          label="Reject"
          confirmLabel="Yes, reject"
          summary={`Reject this ${row.kind} request for ${row.subject_email}. Record below why.`}
          onConfirm={async () => {
            if (!noteValid) {
              return { ok: false, message: "Add a short note first." };
            }
            const res = await approve({
              requestId: row.requestId as never,
              decision: "rejected",
              verification_method: method.trim(),
            });
            return res.ok
              ? { ok: true, message: "Rejected and recorded." }
              : { ok: false, message: "That could not be completed." };
          }}
        >
          <label style={label}>
            Reason (required)
            <input
              style={input}
              value={method}
              onChange={(e) => setMethod(e.target.value)}
              placeholder="e.g. could not confirm identity"
            />
          </label>
        </ConfirmAction>
      </div>
    </div>
  );
}
