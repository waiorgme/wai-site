import { useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { linkBtn, muted, primaryBtn } from "../portal/ui";

// The one propose-then-confirm pattern for every admin write (spec criterion 7,
// the vault's propose-then-confirm rule made concrete once). Shows a
// plain-language summary of what will change, requires an explicit second click
// ("Yes, do this" / "Cancel"), and shows the resulting state inline (no silent
// success). Reused by all four queues.

type Result = { ok: boolean; message: string };

export function ConfirmAction({
  label,
  summary,
  confirmLabel,
  onConfirm,
  children,
  disabled,
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
}) {
  const [proposing, setProposing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Result | null>(null);

  if (outcome !== null) {
    return (
      <p style={{ ...muted, margin: 0, color: outcome.ok ? "var(--sky)" : "#ff9b9b" }}>
        {outcome.message}
      </p>
    );
  }

  if (!proposing) {
    return (
      <button
        type="button"
        style={linkBtn}
        disabled={disabled}
        onClick={() => setProposing(true)}
      >
        {label}
      </button>
    );
  }

  return (
    <div style={proposeBox}>
      <p style={{ ...muted, margin: 0, fontSize: 14 }}>{summary}</p>
      {children}
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <button
          type="button"
          style={{ ...primaryBtn, opacity: busy ? 0.7 : 1 }}
          disabled={busy}
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
          style={linkBtn}
          disabled={busy}
          onClick={() => setProposing(false)}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

const proposeBox: CSSProperties = {
  display: "grid",
  gap: 12,
  padding: "12px 14px",
  borderRadius: "var(--r-card)",
  border: "1px solid rgba(207, 224, 245, 0.22)",
  background: "var(--ink)",
};
