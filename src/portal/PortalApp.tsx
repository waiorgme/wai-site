import { useState, type CSSProperties } from "react";
import {
  Authenticated,
  AuthLoading,
  ConvexReactClient,
  Unauthenticated,
  useQuery,
} from "convex/react";
import { ConvexAuthProvider, useAuthActions } from "@convex-dev/auth/react";
import { api } from "../../convex/_generated/api";

// Client-side Convex connection for the portal islands. The deployment URL is
// exposed to the browser via Astro's PUBLIC_ prefix.
const convex = new ConvexReactClient(import.meta.env.PUBLIC_CONVEX_URL as string);

export function PortalApp() {
  return (
    <ConvexAuthProvider client={convex}>
      <AuthLoading>
        <div style={card}>
          <p style={muted}>Loading…</p>
        </div>
      </AuthLoading>
      <Unauthenticated>
        <SignIn />
      </Unauthenticated>
      <Authenticated>
        <MemberPanel />
      </Authenticated>
    </ConvexAuthProvider>
  );
}

function SignIn() {
  const { signIn } = useAuthActions();
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (sentTo !== null) {
    return (
      <div style={card}>
        <h1 style={h1}>Check your email</h1>
        <p style={muted}>
          We sent a sign-in link to{" "}
          <strong style={{ color: "var(--white)" }}>{sentTo}</strong>. It expires
          in 15 minutes and can be used once.
        </p>
        <button type="button" style={linkBtn} onClick={() => setSentTo(null)}>
          Use a different email
        </button>
      </div>
    );
  }

  return (
    <div style={card}>
      <h1 style={h1}>Member sign-in</h1>
      <p style={muted}>
        Enter your email and we'll send you a secure sign-in link — no password
        needed.
      </p>
      <form
        style={{ display: "grid", gap: 12, marginTop: 8 }}
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
          } catch {
            setError("Something went wrong sending your link. Please try again.");
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
          placeholder="you@example.com"
          style={input}
        />
        <button type="submit" disabled={busy} style={primaryBtn}>
          {busy ? "Sending…" : "Send sign-in link"}
        </button>
        {error !== null && (
          <p style={{ ...muted, color: "#ff9b9b" }}>{error}</p>
        )}
      </form>
    </div>
  );
}

function MemberPanel() {
  const { signOut } = useAuthActions();
  const me = useQuery(api.members.getCurrentMember);
  const firstName = me?.name?.split(" ")[0];

  return (
    <div style={card}>
      <h1 style={h1}>Welcome{firstName ? `, ${firstName}` : ""}</h1>
      {me === undefined ? (
        <p style={muted}>Loading your profile…</p>
      ) : me === null ? (
        <p style={muted}>
          You're signed in, but there's no member profile linked to this email
          yet.
        </p>
      ) : (
        <dl style={dl}>
          <Row label="Email" value={me.email} />
          <Row label="Status" value={me.lifecycle_state} />
          <Row label="Access lane" value={me.member_lane} />
        </dl>
      )}
      <button type="button" style={linkBtn} onClick={() => void signOut()}>
        Sign out
      </button>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 16 }}>
      <dt style={{ color: "var(--mist)", opacity: 0.7 }}>{label}</dt>
      <dd
        style={{
          margin: 0,
          color: "var(--white)",
          fontFamily: "var(--mono)",
          fontSize: 14,
        }}
      >
        {value}
      </dd>
    </div>
  );
}

const card: CSSProperties = {
  width: "min(420px, 100%)",
  background: "var(--ink-2)",
  border: "1px solid rgba(207, 224, 245, 0.14)",
  borderRadius: "var(--r-card)",
  padding: "32px 28px",
  display: "grid",
  gap: 14,
  boxShadow: "0 24px 60px rgba(0,0,0,0.4)",
};

const h1: CSSProperties = {
  margin: 0,
  fontFamily: "var(--display)",
  fontWeight: 700,
  fontSize: 26,
  color: "var(--white)",
};

const muted: CSSProperties = {
  margin: 0,
  color: "var(--mist)",
  lineHeight: 1.5,
  fontFamily: "var(--body)",
};

const input: CSSProperties = {
  width: "100%",
  padding: "12px 14px",
  borderRadius: 12,
  border: "1px solid rgba(207, 224, 245, 0.22)",
  background: "var(--ink)",
  color: "var(--white)",
  fontSize: 16,
  fontFamily: "var(--body)",
};

const primaryBtn: CSSProperties = {
  padding: "12px 16px",
  borderRadius: "var(--r-chip)",
  border: "none",
  background: "var(--sky)",
  color: "var(--ink)",
  fontWeight: 700,
  fontSize: 15,
  fontFamily: "var(--body)",
  cursor: "pointer",
};

const linkBtn: CSSProperties = {
  justifySelf: "start",
  marginTop: 4,
  padding: 0,
  border: "none",
  background: "none",
  color: "var(--sky)",
  fontFamily: "var(--body)",
  fontSize: 14,
  cursor: "pointer",
  textDecoration: "underline",
};

const dl: CSSProperties = {
  margin: 0,
  display: "grid",
  gap: 10,
  padding: "12px 0",
  borderTop: "1px solid rgba(207, 224, 245, 0.12)",
  borderBottom: "1px solid rgba(207, 224, 245, 0.12)",
};
