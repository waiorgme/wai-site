import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
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
  // Super-admin-only actions (spec F15): a plain admin sees the honest words
  // instead of buttons the server would refuse. Guarded here, once, so every
  // caller (Certificates view, member dossier) inherits the rule.
  const role = useQuery(api.lib.adminAuth.myAdminRole);
  const revoke = useMutation(api.admin.certificates.revokeCertificate);
  const reissue = useMutation(api.admin.certificates.reissueCertificate);

  const [open, setOpen] = useState<ModalKind>(null);
  const [reason, setReason] = useState("");
  const [correctedName, setCorrectedName] = useState(recipientName);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<{ ok: boolean; message: string } | null>(null);

  // On success the modal unmounts and its opener is gone, so hand focus to
  // the outcome line; keyboard users keep their place in the table.
  const okRef = useRef<HTMLParagraphElement | null>(null);
  useEffect(() => {
    if (outcome !== null && outcome.ok) {
      okRef.current?.focus();
    }
  }, [outcome]);

  // Success is terminal: the certificate's state has changed and the row's
  // actions no longer apply. A failure keeps the action links below.
  if (outcome !== null && outcome.ok) {
    return (
      <p role="status" tabIndex={-1} ref={okRef} className="pn-ok">
        {outcome.message}
      </p>
    );
  }

  if (status !== "valid") {
    // Superseded and revoked rows are settled records; nothing to act on.
    return <span className="pn-meta">Settled record</span>;
  }

  if (role !== "super_admin") {
    return (
      <span className="pn-meta">
        Revoke and re-issue are super-admin actions.
      </span>
    );
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
                ? "Please enter the member's full name - first and family name - as it should read on the certificate."
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
      <button
        type="button"
        className="pn-link"
        onClick={() => {
          setOutcome(null);
          setOpen("revoke");
        }}
      >
        Revoke
      </button>
      <button
        type="button"
        className="pn-link"
        onClick={() => {
          setOutcome(null);
          setOpen("reissue");
        }}
      >
        Re-issue correction
      </button>
      {outcome !== null ? (
        <span role="status" className="pn-error">
          {outcome.message}
        </span>
      ) : null}
      {open === "revoke" && (
        <Modal
          title="Revoke this certificate"
          sub={`${numberLabel} · ${recipientName}`}
          onClose={close}
          onConfirm={() => void onRevoke()}
          confirmLabel={busy ? "Working…" : "Yes, revoke it"}
          confirmDisabled={busy || reason.trim() === ""}
          footNote="Recorded in the audit log. The public verification page will answer 'revoked' for this certificate. Only you and Issam can do this."
        >
          <p className="pn-meta">
            Her membership and number are not changed by this - only the
            certificate stops being valid. She is not sent anything
            automatically; contact her yourself if she should know.
          </p>
          <label className="pn-label">
            Reason (required, goes in the audit log)
            <textarea
              className="pn-input pn-textarea"
              value={reason}
              maxLength={140}
              placeholder="e.g. issued in error to the wrong person"
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
          <p className="pn-hint">Up to 140 characters.</p>
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
          footNote="Recorded in the audit log. The member is told her corrected certificate is ready. Only you and Issam can do this."
        >
          <label className="pn-label">
            Corrected name (exactly as it should appear)
            <input
              className="pn-input"
              value={correctedName}
              maxLength={120}
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
