import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import { linkBtn, muted } from "./ui";

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
      style={{
        display: "grid",
        gap: 10,
        borderTop: compact ? "none" : "1px solid rgba(207, 224, 245, 0.12)",
        paddingTop: compact ? 0 : 16,
      }}
    >
      <p style={{ ...muted, margin: 0 }}>
        <strong style={{ color: "var(--white)" }}>Your data.</strong> You can ask
        us to send you a copy of the data we hold about you, or to delete it. A
        team member reviews every request before we act on it.
      </p>
      <div style={{ display: "flex", gap: 18, flexWrap: "wrap" }}>
        <button
          type="button"
          style={linkBtn}
          disabled={busy}
          onClick={() => void request("export")}
        >
          Ask for a copy of my data
        </button>
        <button
          type="button"
          style={linkBtn}
          disabled={busy}
          onClick={() => void request("erasure")}
        >
          Ask us to delete my data
        </button>
      </div>
      {message !== null && (
        <p role="status" style={{ ...muted, fontSize: 13, margin: 0 }}>
          {message}
        </p>
      )}
      <p style={{ ...muted, fontSize: 12.5, margin: 0, opacity: 0.75 }}>
        You can also email{" "}
        <a href="mailto:support@waiorg.me" style={{ color: "var(--sky)" }}>
          support@waiorg.me
        </a>
        .
      </p>
    </section>
  );
}
