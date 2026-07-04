import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { checkboxRow, errorText, linkBtn, muted } from "./ui";

// "Your choices": the two opt-in toggles (field spec Group H). Labels and
// tips follow the field spec's plain-language microcopy. Both default OFF;
// the server locks them off for members under 18 (the UI never offers them).

export function Settings({ onClose }: { onClose: () => void }) {
  const settings = useQuery(api.members.getMySettings);
  const setDirectory = useMutation(api.members.setDirectoryVisible);
  const setPipeline = useMutation(api.members.setPipelineOptIn);
  const [confirmingPipeline, setConfirmingPipeline] = useState(false);
  const [attested, setAttested] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (settings === undefined) {
    return <p style={muted}>Loading your choices…</p>;
  }
  if (settings === null) {
    return <p style={muted}>There's no member profile linked to this email yet.</p>;
  }

  if (settings.locked) {
    return (
      <div style={{ display: "grid", gap: 12 }}>
        <p style={muted}>These options open when you turn 18.</p>
        <button type="button" style={linkBtn} onClick={onClose}>
          Back
        </button>
      </div>
    );
  }

  const run = async (fn: () => Promise<{ ok: boolean }>) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fn();
      if (!res.ok) {
        setError("That didn't save. Please try again.");
      }
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: "grid", gap: 20 }}>
      <section style={{ display: "grid", gap: 8 }}>
        <label style={checkboxRow}>
          <input
            type="checkbox"
            disabled={busy}
            checked={settings.directory_visible}
            onChange={(e) => void run(() => setDirectory({ value: e.target.checked }))}
          />
          <span>
            <strong style={{ color: "var(--white)" }}>
              Show my profile in the member directory
            </strong>
            <br />
            Turn this on to appear in our members' directory, so other women in
            aviation can find and connect with you. Off by default, it's your
            choice.
          </span>
        </label>
      </section>

      {/* The pipeline is women-only: the whole section never renders for the
          ally lane (the server refuses it too, whatever the client shows). */}
      {!settings.pipeline_locked && (
      <section style={{ display: "grid", gap: 8 }}>
        {settings.pipeline_state === "off" || settings.pipeline_state === "rejected" ? (
          <>
            <label style={checkboxRow}>
              <input
                type="checkbox"
                disabled={busy}
                checked={confirmingPipeline}
                onChange={(e) => {
                  setConfirmingPipeline(e.target.checked);
                  setAttested(false);
                }}
              />
              <span>
                <strong style={{ color: "var(--white)" }}>
                  Open to opportunities, let approved corporate partners find me
                  for jobs, internships and scholarships
                </strong>
                <br />
                Turn this on to let trusted aviation employers we work with find
                you for jobs, internships, and scholarships. We always introduce
                you, they never get your contact details directly. Off by
                default.
              </span>
            </label>
            {settings.pipeline_state === "rejected" && !confirmingPipeline && (
              <p style={{ ...muted, fontSize: 14 }}>
                This isn't switched on for your profile right now. If you think
                that's a mistake, write to us at{" "}
                <a href="mailto:support@waiorg.me" style={{ color: "var(--sky)" }}>
                  support@waiorg.me
                </a>
                .
              </p>
            )}
            {confirmingPipeline && (
              <div style={{ display: "grid", gap: 10, paddingInlineStart: 26 }}>
                <label style={checkboxRow}>
                  <input
                    type="checkbox"
                    checked={attested}
                    onChange={(e) => setAttested(e.target.checked)}
                  />
                  <span>
                    I confirm my details, including age and gender, are
                    accurate. (required for this option)
                  </span>
                </label>
                <button
                  type="button"
                  style={{ ...linkBtn, justifySelf: "start" }}
                  disabled={!attested || busy}
                  onClick={() =>
                    void run(async () => {
                      const res = await setPipeline({ value: true, attestation: true });
                      if (res.ok) {
                        setConfirmingPipeline(false);
                        setAttested(false);
                      }
                      return res;
                    })
                  }
                >
                  Turn it on
                </button>
              </div>
            )}
          </>
        ) : (
          <div style={{ display: "grid", gap: 8 }}>
            <p style={{ ...muted, margin: 0 }}>
              <strong style={{ color: "var(--white)" }}>
                Open to opportunities:
              </strong>{" "}
              {settings.pipeline_state === "review_pending"
                ? "almost on. A team member checks this once, then partners can find you. You don't need to do anything."
                : "on. Trusted partners we work with can find your profile. We always introduce you; they never get your contact details directly."}
            </p>
            <button
              type="button"
              style={{ ...linkBtn, justifySelf: "start" }}
              disabled={busy}
              onClick={() => void run(() => setPipeline({ value: false }))}
            >
              Turn it off
            </button>
          </div>
        )}
      </section>
      )}

      {error !== null && <p style={errorText}>{error}</p>}

      <YourData />

      <button type="button" style={linkBtn} onClick={onClose}>
        Back
      </button>
    </div>
  );
}

// "Your data" (admin-panel spec criterion 5): the signed-in member can ask for
// an export or erasure of HER OWN account. subject_email is taken from her
// session server-side, never a free-text field here. Submitting only records
// the request; a team member reviews it before anything happens. This is the
// privacy policy's "as the member area grows, these options will also appear
// there directly" moment, for the member area specifically.
function YourData() {
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
    <section style={{ display: "grid", gap: 10, borderTop: "1px solid rgba(207, 224, 245, 0.12)", paddingTop: 16 }}>
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
        <p style={{ ...muted, fontSize: 13, margin: 0 }}>{message}</p>
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
