import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { linkBtn, primaryBtn } from "../portal/ui";

// The one propose-then-confirm pattern for every admin write (spec criterion 7,
// the vault's propose-then-confirm rule made concrete once). Shows a
// plain-language summary of what will change, requires an explicit second click
// ("Yes, do this" / "Cancel"), and shows the resulting state inline (no silent
// success). Reused by all four queues.
//
// panel-design quirk fix (spec criterion 12, recorded): a SUCCESS outcome stays
// terminal, but a FAILED outcome now offers "Try again", returning to the
// proposing step with the caller's inputs preserved - so a validation miss
// (e.g. a required note left empty) no longer dead-ends the action until a
// reload. The two-step confirm is never collapsed.

type Result = { ok: boolean; message: string };

export function ConfirmAction({
  label,
  summary,
  confirmLabel,
  onConfirm,
  children,
  disabled,
  confirmDisabled,
}: {
  // The trigger button copy (e.g. "Resend the guardian email").
  label: string;
  // Plain-language description of exactly what will change if confirmed.
  summary: ReactNode;
  // The confirm button copy; defaults to "Yes, do this".
  confirmLabel?: string;
  // Runs the mutation/action; returns whether it succeeded and a message to
  // show inline. Never throws to the caller: catch inside and return a message.
  onConfirm: () => Promise<Result>;
  // Optional extra inputs shown while proposing (e.g. a verification note).
  children?: ReactNode;
  disabled?: boolean;
  // Keeps the confirm button off until required inputs are filled (the server
  // check stays the backstop).
  confirmDisabled?: boolean;
}) {
  const [proposing, setProposing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Result | null>(null);
  const proposeRef = useRef<HTMLDivElement | null>(null);
  const okRef = useRef<HTMLParagraphElement | null>(null);
  const failRef = useRef<HTMLDivElement | null>(null);

  // Each step transition unmounts the focused element, dropping focus to
  // <body>; move focus with the step so keyboard and screen-reader users keep
  // their place in the row (same discipline as AdminConsole's view pane).
  useEffect(() => {
    if (outcome === null) {
      if (proposing) {
        proposeRef.current?.focus();
      }
    } else if (outcome.ok) {
      okRef.current?.focus();
    } else {
      failRef.current?.focus();
    }
  }, [proposing, outcome]);

  if (outcome !== null) {
    if (outcome.ok) {
      return (
        <p role="status" className="pn-ok" tabIndex={-1} ref={okRef}>
          {outcome.message}
        </p>
      );
    }
    return (
      <div className="pn-stack" tabIndex={-1} ref={failRef}>
        <p role="alert" className="pn-error">
          {outcome.message}
        </p>
        <button
          type="button"
          className={linkBtn}
          onClick={() => setOutcome(null)}
        >
          Try again
        </button>
      </div>
    );
  }

  if (!proposing) {
    return (
      <button
        type="button"
        className={linkBtn}
        disabled={disabled}
        onClick={() => setProposing(true)}
      >
        {label}
      </button>
    );
  }

  return (
    <div className="pn-propose" tabIndex={-1} ref={proposeRef}>
      <p className="pn-meta">{summary}</p>
      {children}
      <div className="pn-confirm-row">
        <button
          type="button"
          className={primaryBtn}
          disabled={busy || confirmDisabled}
          onClick={async () => {
            setBusy(true);
            try {
              const res = await onConfirm();
              setOutcome(res);
            } catch {
              setOutcome({
                ok: false,
                message: "Something went wrong. Please try again.",
              });
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "Working…" : (confirmLabel ?? "Yes, do this")}
        </button>
        <button
          type="button"
          className={linkBtn}
          disabled={busy}
          onClick={() => setProposing(false)}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
