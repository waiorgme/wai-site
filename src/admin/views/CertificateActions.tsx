import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Modal } from "../../panel/kit";

// Revoke / re-issue for one certificate row (panel-experience spec F15).
// Both are propose-then-confirm at modal grade with a required reason or
// corrected name, and both say plainly who may act: the server reserves them
// to super admins. Used by the Certificates view and the member dossier.

type ModalKind = "revoke" | "reissue" | null;

export function CertificateRowActions({
  certificateId,
  status,
  numberLabel,
  recipientName,
}: {
  certificateId: Id<"certificates">;
  status: "valid" | "superseded" | "revoked";
  // e.g. "WAIME-MEM-104"
  numberLabel: string;
  recipientName: string;
}) {
  const revoke = useMutation(api.admin.certificates.revokeCertificate);
  const reissue = useMutation(api.admin.certificates.reissueCertificate);

  const [open, setOpen] = useState<ModalKind>(null);
  const [reason, setReason] = useState("");
  const [correctedName, setCorrectedName] = useState(recipientName);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<{ ok: boolean; message: string } | null>(null);

  if (outcome !== null) {
    return (
      <p role="status" className={outcome.ok ? "pn-ok" : "pn-error"}>
        {outcome.message}
      </p>
    );
  }

  if (status !== "valid") {
    // Superseded and revoked rows are settled records; nothing to act on.
    return <span className="pn-meta">Settled record</span>;
  }

  const close = () => {
    setOpen(null);
    setReason("");
    setCorrectedName(recipientName);
  };

  const onRevoke = async () => {
    setBusy(true);
    try {
      const res = await revoke({ certificateId, reason: reason.trim() });
      if (res.ok) {
        setOutcome({ ok: true, message: "Revoked. The verification page now answers honestly for this certificate." });
        setOpen(null);
      } else {
        setOutcome({
          ok: false,
          message:
            res.error === "ineligible"
              ? "Only the live certificate in a chain can be revoked."
              : "That did not go through. Please try again.",
        });
        setOpen(null);
      }
    } catch {
      setOutcome({ ok: false, message: "Something went wrong. Please try again." });
      setOpen(null);
    } finally {
      setBusy(false);
    }
  };

  const onReissue = async () => {
    setBusy(true);
    try {
      const res = await reissue({ certificateId, correctedName: correctedName.trim() });
      if (res.ok) {
        setOutcome({ ok: true, message: "Correction issued. The member has been told her new certificate is ready." });
        setOpen(null);
      } else {
        setOutcome({
          ok: false,
          message:
            res.error === "ineligible"
              ? "Only the live certificate in a chain can be corrected."
              : res.error === "validation"
                ? "The corrected name cannot be empty."
                : "That did not go through. Please try again.",
        });
        setOpen(null);
      }
    } catch {
      setOutcome({ ok: false, message: "Something went wrong. Please try again." });
      setOpen(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <span className="pn-btn-row">
      <button type="button" className="pn-link" onClick={() => setOpen("revoke")}>
        Revoke
      </button>
      <button type="button" className="pn-link" onClick={() => setOpen("reissue")}>
        Re-issue correction
      </button>
      {open === "revoke" && (
        <Modal
          title="Revoke this certificate"
          sub={`${numberLabel} · ${recipientName}`}
          onClose={close}
          onConfirm={() => void onRevoke()}
          confirmLabel={busy ? "Working…" : "Yes, revoke it"}
          confirmDisabled={busy || reason.trim() === ""}
          footNote="Recorded in the audit log. The public verification page will answer 'revoked' for this certificate. Only a super admin can do this - the server checks."
        >
          <label className="pn-label">
            Reason (required, goes in the audit log)
            <textarea
              className="pn-input pn-textarea"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
        </Modal>
      )}
      {open === "reissue" && (
        <Modal
          title="Re-issue with a corrected name"
          sub={`${numberLabel} · ${recipientName}`}
          onClose={close}
          onConfirm={() => void onReissue()}
          confirmLabel={busy ? "Working…" : "Yes, issue the correction"}
          confirmDisabled={busy || correctedName.trim() === ""}
          footNote="Recorded in the audit log. The member is told her corrected certificate is ready. Only a super admin can do this - the server checks."
        >
          <label className="pn-label">
            Corrected name (exactly as it should appear)
            <input
              className="pn-input"
              value={correctedName}
              onChange={(e) => setCorrectedName(e.target.value)}
            />
          </label>
          <p className="pn-hint">
            {numberLabel} stays the same. The current certificate is marked
            superseded and a new valid one is issued to{" "}
            <strong>{correctedName.trim() === "" ? "…" : correctedName.trim()}</strong>.
            Both stay on the record forever.
          </p>
        </Modal>
      )}
    </span>
  );
}
