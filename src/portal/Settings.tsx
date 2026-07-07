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
  // Optimistic tick for the directory checkbox: it is server-controlled, so
  // without this the tick visibly reverts while the mutation runs.
  const [pendingDirectory, setPendingDirectory] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (settings === undefined) {
    return <p className={muted}>Loading your choices…</p>;
  }
  if (settings === null) {
    return <p className={muted}>There's no member profile linked to this email yet.</p>;
  }

  if (settings.locked) {
    // The directory/pipeline toggles open at 18; data rights do not wait for
    // that (they apply to every member) and live on the Your data page.
    return (
      <div className="pn-stack">
        <p className={muted}>These options open when you turn 18.</p>
        <p className={muted}>
          To ask for a copy of your data, or ask us to delete it, see{" "}
          <a href="#your-data">Your data</a>.
        </p>
        <button type="button" className={linkBtn} onClick={onClose}>
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
        <label className={checkboxRow}>
          <input
            type="checkbox"
            disabled={busy}
            checked={pendingDirectory ?? settings.directory_visible}
            onChange={(e) => {
              const next = e.target.checked;
              setPendingDirectory(next);
              void run(async () => {
                try {
                  const res = await setDirectory({ value: next });
                  if (!res.ok) {
                    setPendingDirectory(null);
                  }
                  return res;
                } catch (err) {
                  setPendingDirectory(null);
                  throw err;
                }
              });
            }}
          />
          <span>
            <strong>
              Show my profile in the member directory
            </strong>
            <br />
            Turn this on to appear in our member directory, so other women in
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
            <label className={checkboxRow}>
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
                <strong>
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
              <p className={muted}>
                This isn't switched on for your profile right now. If you think
                that's a mistake, write to us at{" "}
                <a href="mailto:support@waiorg.me">
                  support@waiorg.me
                </a>
                .
              </p>
            )}
            {confirmingPipeline && (
              <div style={{ display: "grid", gap: 10, paddingInlineStart: 26 }}>
                <label className={checkboxRow}>
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
                  className={linkBtn}
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
            <p className={muted}>
              <strong>
                Open to opportunities:
              </strong>{" "}
              {settings.pipeline_state === "review_pending"
                ? "almost on. A team member checks this once, then partners can find you. You don't need to do anything."
                : "on. Trusted partners we work with can find your profile. We always introduce you; they never get your contact details directly."}
            </p>
            <button
              type="button"
              className={linkBtn}
              disabled={busy}
              onClick={() => void run(() => setPipeline({ value: false }))}
            >
              Turn it off
            </button>
          </div>
        )}
      </section>
      )}

      {error !== null && <p role="alert" className={errorText}>{error}</p>}

      <p className={muted}>
        To ask for a copy of your data, or ask us to delete it, see{" "}
        <a href="#your-data">Your data</a>.
      </p>

      <button type="button" className={linkBtn} onClick={onClose}>
        Back
      </button>
    </div>
  );
}
