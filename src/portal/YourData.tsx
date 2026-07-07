import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import { hint, linkBtn, muted } from "./ui";

// "Your data" (admin-panel spec criterion 5; vault Privacy & Data Protection +
// privacy policy line 73). The signed-in member can ask for an export or erasure
// of HER OWN account. subject_email is taken from her session server-side, never
// a free-text field here. Submitting only records the request; a team member
// reviews it before anything happens.
//
// Data rights apply to EVERY member, so this renders in every signed-in state
// (active adult, active minor, pending_guardian, pending_review,
// restricted_unknown) - never behind the adult-only directory/pipeline locks.
// The server (submitMyDataRequest) is deliberately not gated by any
// lifecycle/lane surface lock, so the request always goes through.

export function YourData({ compact = false }: { compact?: boolean }) {
  const submit = useMutation(api.admin.dataRequests.submitMyDataRequest);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  // Erasure is propose-then-confirm: a stray tap must never file a deletion
  // request the member cannot retract here. Export stays one tap.
  const [confirmingErasure, setConfirmingErasure] = useState(false);

  const request = async (kind: "export" | "erasure") => {
    setBusy(true);
    setMessage(null);
    try {
      const res = await submit({ kind });
      setMessage(
        res.ok
          ? "Thanks. We have logged your request and a team member will be in touch."
          : res.error === "rate_limited"
            ? "You have made a few of these recently. Please try again later."
            : "Something went wrong. Please try again.",
      );
    } catch {
      setMessage("Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      // Functional inline style: compact keeps the section flush inside its
      // own card; non-compact draws a light hairline above (logical border).
      style={{
        display: "grid",
        gap: 10,
        borderBlockStart: compact ? "none" : "1px solid var(--hair-l)",
        paddingBlockStart: compact ? 0 : 16,
      }}
    >
      <p className={muted}>
        <strong>Your data.</strong> You can ask
        us to send you a copy of the data we hold about you, or to delete it. A
        team member reviews every request before we act on it.
      </p>
      <div className="pn-actions">
        <button
          type="button"
          className={linkBtn}
          disabled={busy}
          onClick={() => void request("export")}
        >
          Ask for a copy of my data
        </button>
        {!confirmingErasure && (
          <button
            type="button"
            className={linkBtn}
            disabled={busy}
            onClick={() => {
              setMessage(null);
              setConfirmingErasure(true);
            }}
          >
            Ask us to delete my data
          </button>
        )}
      </div>
      {confirmingErasure && (
        <div className="pn-propose">
          <p className={muted}>
            This asks us to delete your whole account and data. A person
            reviews the request before anything happens.
          </p>
          <div className="pn-confirm-row">
            <button
              type="button"
              className="pn-btn"
              disabled={busy}
              onClick={() => {
                setConfirmingErasure(false);
                void request("erasure");
              }}
            >
              Yes, ask us to delete it
            </button>
            <button
              type="button"
              className={linkBtn}
              disabled={busy}
              onClick={() => setConfirmingErasure(false)}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
      {message !== null && (
        <p role="status" className={muted}>
          {message}
        </p>
      )}
      <p className={hint}>
        You can also email{" "}
        <a href="mailto:support@waiorg.me">
          support@waiorg.me
        </a>
        .
      </p>
    </section>
  );
}
