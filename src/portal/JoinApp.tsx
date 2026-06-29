import { useEffect, useRef, useState } from "react";
import { useAction } from "convex/react";
import { ConvexAuthProvider, useAuthActions } from "@convex-dev/auth/react";
import { api } from "../../convex/_generated/api";
import { convex } from "./convex";
import {
  card,
  checkboxRow,
  errorText,
  h1,
  input,
  label,
  linkBtn,
  muted,
  primaryBtn,
} from "./ui";

declare global {
  interface Window {
    turnstile?: {
      render: (
        el: HTMLElement,
        opts: {
          sitekey: string;
          callback: (token: string) => void;
          "error-callback"?: () => void;
          "expired-callback"?: () => void;
          theme?: "auto" | "light" | "dark";
        },
      ) => string;
      remove: (id: string) => void;
    };
  }
}

// The five public career-stage options (field spec Group B). Stored raw; the
// internal Dreamer/Entrant/Professional/Leader mapping is applied in a later slice.
const CAREER_STAGES = [
  "Dreaming of starting",
  "Studying / cadet",
  "Trying to break in",
  "Working in aviation",
  "Working in another field",
];

export function JoinApp() {
  return (
    <ConvexAuthProvider client={convex}>
      <JoinForm />
    </ConvexAuthProvider>
  );
}

function JoinForm() {
  const submitJoin = useAction(api.members.submitJoin);
  const { signIn } = useAuthActions();
  const [token, setToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);

  if (sentTo !== null) {
    return (
      <div style={card}>
        <h1 style={h1}>Almost there — check your email</h1>
        <p style={muted}>
          Welcome to WAI-ME. We sent a confirmation link to{" "}
          <strong style={{ color: "var(--white)" }}>{sentTo}</strong>. Click it to
          confirm your email and activate your membership. It expires in 15
          minutes.
        </p>
      </div>
    );
  }

  return (
    <div style={card}>
      <h1 style={h1}>Join WAI-ME</h1>
      <p style={muted}>
        Membership is free and open to women at every stage of aviation. Allies
        are welcome too.
      </p>
      <form
        style={{ display: "grid", gap: 14, marginTop: 4 }}
        onSubmit={async (event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          const email = String(form.get("email") ?? "").trim();
          const name = String(form.get("name") ?? "").trim();
          const dob = String(form.get("dob") ?? "").trim();
          if (token === null) {
            setError("Please complete the verification check.");
            return;
          }
          setBusy(true);
          setError(null);
          try {
            const result = await submitJoin({
              name,
              email,
              dobAnswer: dob === "" ? undefined : dob,
              genderAnswer: form.get("gender") === "male" ? "male" : "female",
              careerStageAnswer: String(form.get("careerStage") ?? ""),
              consents: {
                terms: form.get("terms") === "on",
                marketing: form.get("marketing") === "on",
                pipeline: form.get("pipeline") === "on",
              },
              turnstileToken: token,
            });
            if (result.ok === false) {
              setError("We couldn't complete your sign-up. Please try again.");
              return;
            }
            await signIn("resend", { email, redirectTo: "/portal" });
            setSentTo(email);
          } catch {
            setError("Something went wrong. Please try again.");
          } finally {
            setBusy(false);
          }
        }}
      >
        <label style={label}>
          Full name
          <input name="name" type="text" required autoComplete="name" style={input} />
        </label>

        <label style={label}>
          Email
          <input
            name="email"
            type="email"
            required
            autoComplete="email"
            placeholder="you@example.com"
            style={input}
          />
        </label>

        <label style={label}>
          Date of birth
          <input name="dob" type="date" required style={input} />
        </label>

        <fieldset style={{ border: "none", padding: 0, margin: 0, ...label }}>
          <span>I am a…</span>
          <div style={{ display: "flex", gap: 18, color: "var(--white)" }}>
            <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <input type="radio" name="gender" value="female" defaultChecked /> Woman
            </label>
            <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <input type="radio" name="gender" value="male" /> Ally
            </label>
          </div>
        </fieldset>

        <label style={label}>
          Where are you in aviation right now?
          <select name="careerStage" required defaultValue="" style={input}>
            <option value="" disabled>
              Select one…
            </option>
            {CAREER_STAGES.map((stage) => (
              <option key={stage} value={stage}>
                {stage}
              </option>
            ))}
          </select>
        </label>

        <label style={checkboxRow}>
          <input type="checkbox" name="terms" required />
          <span>
            I agree to the WAI-ME terms and privacy policy. <em>(required)</em>
          </span>
        </label>
        <label style={checkboxRow}>
          <input type="checkbox" name="marketing" />
          <span>Email me about events, opportunities and news. (optional)</span>
        </label>
        <label style={checkboxRow}>
          <input type="checkbox" name="pipeline" />
          <span>
            Let WAI-ME include me in the opt-in talent pipeline for partners.
            (optional)
          </span>
        </label>

        <Turnstile onToken={setToken} />

        <button type="submit" disabled={busy} style={primaryBtn}>
          {busy ? "Creating your account…" : "Join WAI-ME"}
        </button>
        {error !== null && <p style={errorText}>{error}</p>}
      </form>
      <p style={{ ...muted, fontSize: 13 }}>
        Already a member?{" "}
        <a href="/portal" style={{ color: "var(--sky)" }}>
          Sign in
        </a>
        .
      </p>
    </div>
  );
}

function Turnstile({ onToken }: { onToken: (token: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const sitekey = import.meta.env.PUBLIC_TURNSTILE_SITEKEY as string | undefined;
    if (sitekey === undefined || ref.current === null) {
      return;
    }
    const container = ref.current;
    let widgetId: string | undefined;

    const render = () => {
      if (window.turnstile && widgetId === undefined) {
        widgetId = window.turnstile.render(container, {
          sitekey,
          theme: "dark",
          callback: onToken,
        });
      }
    };

    if (window.turnstile) {
      render();
    } else {
      const existing = document.getElementById("cf-turnstile-script");
      if (existing) {
        existing.addEventListener("load", render);
      } else {
        const script = document.createElement("script");
        script.id = "cf-turnstile-script";
        script.src =
          "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
        script.async = true;
        script.addEventListener("load", render);
        document.head.appendChild(script);
      }
    }

    return () => {
      if (widgetId !== undefined && window.turnstile) {
        window.turnstile.remove(widgetId);
      }
    };
  }, [onToken]);

  return <div ref={ref} />;
}
