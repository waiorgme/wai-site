import { useEffect, useState } from "react";
import { ConvexProvider, useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { convex } from "./convex";
import { card, h1, muted, primaryBtn } from "./ui";

// The guardian consent page (Under-18 decision: a REAL confirmation step).
// The emailed link lands here; consent happens only when the guardian presses
// the button, never on page load, so a mail scanner's prefetch can't consent
// on their behalf. No member data is shown to an invalid token.
export function GuardianConfirmApp() {
  return (
    <ConvexProvider client={convex}>
      <GuardianConfirm />
    </ConvexProvider>
  );
}

// Brand row above the centered card (light logo asset on paper).
function Brand() {
  return (
    <div className="pn-brand" style={{ marginBlockEnd: 18 }}>
      <img src="/assets/wai-me-logo.png" alt="Women in Aviation Middle East" />
    </div>
  );
}

function GuardianConfirm() {
  const [token, setToken] = useState<string | null>(null);
  const [slow, setSlow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<null | "confirmed" | "already_confirmed" | "invalid">(null);
  const confirm = useMutation(api.guardians.confirmGuardianConsent);

  useEffect(() => {
    setToken(new URLSearchParams(window.location.search).get("token"));
  }, []);

  const lookup = useQuery(
    api.guardians.lookupGuardianToken,
    token && done === null ? { token } : "skip",
  );

  // Trust surface: never spin forever (same rule as /verify).
  useEffect(() => {
    if (lookup !== undefined || !token || done !== null) {
      setSlow(false);
      return;
    }
    const timer = window.setTimeout(() => setSlow(true), 8000);
    return () => window.clearTimeout(timer);
  }, [lookup, token, done]);

  if (token === null || token === "") {
    return (
      <>
        <Brand />
        <div className={card}>
          <h1 className={h1}>Guardian confirmation</h1>
          <p className={muted}>
            This page confirms a young member's WAI-ME membership. Please open it
            from the link in the email we sent you. If the link doesn't work,
            write to us at{" "}
            <a href="mailto:support@waiorg.me">
              support@waiorg.me
            </a>
            .
          </p>
        </div>
      </>
    );
  }

  const state = done ?? lookup?.state;

  if (state === undefined) {
    return (
      <>
        <Brand />
        <div className={card}>
          {slow ? (
            <>
              <h1 className={h1}>We can't reach our records right now</h1>
              <p className={muted}>
                This is usually temporary. Please reload the page in a minute, or
                write to us at{" "}
                <a href="mailto:support@waiorg.me">
                  support@waiorg.me
                </a>{" "}
                and we will handle it by email.
              </p>
            </>
          ) : (
            <p className={muted}>One moment…</p>
          )}
        </div>
      </>
    );
  }

  if (state === "confirmed") {
    return (
      <>
        <Brand />
        <div className={card}>
          <h1 className={h1}>Thank you, membership confirmed</h1>
          <p className={muted}>
            Your consent is recorded and the membership is now active. We have
            sent nothing else; the young member simply signs in as usual. You can
            read how we protect members under 18 at any time on our{" "}
            <a href="/safeguarding">
              safeguarding page
            </a>
            , and you can withdraw this permission whenever you wish by emailing{" "}
            <a href="mailto:support@waiorg.me">
              support@waiorg.me
            </a>
            .
          </p>
        </div>
      </>
    );
  }

  if (state === "already_confirmed") {
    return (
      <>
        <Brand />
        <div className={card}>
          <h1 className={h1}>Already confirmed</h1>
          <p className={muted}>
            This membership was already confirmed, so there is nothing more to
            do. Questions at any time:{" "}
            <a href="mailto:support@waiorg.me">
              support@waiorg.me
            </a>
            .
          </p>
        </div>
      </>
    );
  }

  if (state === "invalid") {
    return (
      <>
        <Brand />
        <div className={card}>
          <h1 className={h1}>This link isn't valid anymore</h1>
          <p className={muted}>
            Confirmation links work once and expire after 30 days. If you still
            want to confirm the membership, ask the young member to send the
            email again from her account, or write to us at{" "}
            <a href="mailto:support@waiorg.me">
              support@waiorg.me
            </a>{" "}
            and we will sort it out.
          </p>
        </div>
      </>
    );
  }

  return (
    <>
      <Brand />
      <div className={card}>
        <h1 className={h1}>One button, and she's in</h1>
        <p className={muted}>
          You are confirming that you are{" "}
          <strong>
            {lookup?.applicantFirstName}
          </strong>
          's parent or guardian and that you consent to her WAI-ME membership.
          Members under 18 join a protected youth lane: no adult features, no
          contact from partners, and nothing shared without you. Details are on
          our{" "}
          <a href="/safeguarding">
            safeguarding page
          </a>
          .
        </p>
        <button
          type="button"
          className={primaryBtn}
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              const result = await confirm({ token: token ?? "" });
              setDone(result.state);
            } catch {
              setDone(null);
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy
            ? "Confirming…"
            : `Yes, I confirm I'm ${lookup?.applicantFirstName}'s parent or guardian and consent to this membership`}
        </button>
      </div>
    </>
  );
}
