import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { checkboxRow, errorText, linkBtn, muted } from "./ui";
import { YourData } from "./YourData";

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
    // The directory/pipeline toggles open at 18; data rights do not wait for
    // that (they apply to every member), so Your data still renders here.
    return (
      <div style={{ display: "grid", gap: 16 }}>
        <p style={muted}>These options open when you turn 18.</p>
        <YourData />
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
