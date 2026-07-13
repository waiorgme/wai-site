import { useState, type ReactNode } from "react";
import { Authenticated, AuthLoading, Unauthenticated } from "convex/react";
import { ConvexAuthProvider, useAuthActions } from "@convex-dev/auth/react";
import { convex } from "./convex";
import { sendLinkErrorMessage } from "./errors";
import { Dashboard } from "./Dashboard";
import { ErrorBoundary } from "./ErrorBoundary";
import {
  card,
  errorText,
  h1,
  hint,
  input,
  linkBtn,
  muted,
  primaryBtn,
} from "./ui";

export function PortalApp() {
  return (
    <ConvexAuthProvider client={convex}>
      <AuthLoading>
        <div className="pn-center">
          <Brand />
          <div className={card}>
            <p className="pn-eyebrow on-paper">Member portal</p>
            <p className={muted}>Loading…</p>
          </div>
        </div>
      </AuthLoading>
      <Unauthenticated>
        <SignIn />
      </Unauthenticated>
      <Authenticated>
        <ErrorBoundary
          fallback={
            <div className="pn-center">
              <Brand />
              <div className={card}>
                <p className="pn-eyebrow on-paper">Member portal</p>
                <h1 className={h1}>Something went wrong</h1>
                <p className={muted}>
                  Something went wrong on our side. Reload the page, or email{" "}
                  <a href="mailto:support@waiorg.me">support@waiorg.me</a> and we
                  will sort it out together.
                </p>
                <button
                  type="button"
                  className={linkBtn}
                  onClick={() => window.location.reload()}
                >
                  Reload the page
                </button>
              </div>
            </div>
          }
        >
          <Dashboard />
        </ErrorBoundary>
      </Authenticated>
    </ConvexAuthProvider>
  );
}

// The light logo row above centered cards (the panel system's brand mark on paper).
function Brand() {
  return (
    <div className="pn-brand">
      <img src="/assets/wai-me-logo.png" alt="Women in Aviation Middle East" />
    </div>
  );
}

// The signed-out shell (Issam 2026-07-13 redesign): a split-screen welcome -
// real archive photography on the ink side, the form on paper - replacing the
// bare centered card. One shell serves both signed-out states so the
// check-your-email moment keeps the same room.
function SignInShell({ children }: { children: ReactNode }) {
  return (
    <div className="signin">
      <aside className="signin-visual">
        <img
          className="signin-photo"
          src="/assets/photos/hero-front-row.webp"
          alt=""
          aria-hidden="true"
        />
        <div className="signin-veil" aria-hidden="true" />
        <div className="signin-copy">
          <img
            className="signin-logo"
            src="/assets/wai-me-logo-on-dark.png"
            alt="Women in Aviation Middle East"
          />
          <h2>Welcome back.</h2>
          <p>
            Your community, your certificate, your next step - one click away.
          </p>
          <div className="signin-horizon" aria-hidden="true" />
        </div>
      </aside>
      <div className="signin-side">
        <a className="signin-back" href="/">
          &larr; waiorg.me
        </a>
        <div className="signin-box">{children}</div>
      </div>
    </div>
  );
}

function SignIn() {
  const { signIn } = useAuthActions();
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (sentTo !== null) {
    return (
      <SignInShell>
        <p className="pn-eyebrow on-paper">Member portal</p>
        <h1 className="pn-h1">Check your email</h1>
        <p className={muted}>
          We sent a sign-in link to <strong>{sentTo}</strong>. It expires in 15
          minutes and can be used once. No password to remember - the link IS
          the sign-in.
        </p>
        <button type="button" className={linkBtn} onClick={() => setSentTo(null)}>
          Use a different email
        </button>
      </SignInShell>
    );
  }

  return (
    <SignInShell>
      <p className="pn-eyebrow on-paper">Member portal</p>
      <h1 className="pn-h1">Sign in</h1>
      <p className={muted}>
        Type your email and we send you a one-click sign-in link. No password
        to remember.
      </p>
        <form
          className="pn-stack"
          onSubmit={async (event) => {
            event.preventDefault();
            const email = String(
              new FormData(event.currentTarget).get("email") ?? "",
            ).trim();
            if (email === "") {
              return;
            }
            setBusy(true);
            setError(null);
            try {
              await signIn("resend", { email, redirectTo: "/portal" });
              setSentTo(email);
            } catch (err) {
              setError(sendLinkErrorMessage(err));
            } finally {
              setBusy(false);
            }
          }}
        >
          <input
            name="email"
            type="email"
            required
            autoComplete="email"
            aria-label="Email address"
            placeholder="you@example.com"
            className={input}
          />
          <button type="submit" disabled={busy} className={primaryBtn}>
            {busy ? "Sending…" : "Send sign-in link"}
          </button>
          {error !== null && <p role="alert" className={errorText}>{error}</p>}
        </form>
        <p className={hint}>
          New to WAI-ME? <a href="/join">Join free</a> &middot;{" "}
          <a href="/membership">What membership includes</a>
        </p>
    </SignInShell>
  );
}
