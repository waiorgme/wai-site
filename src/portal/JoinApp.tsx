import { useEffect, useRef, useState } from "react";
import { useAction } from "convex/react";
import { ConvexAuthProvider, useAuthActions } from "@convex-dev/auth/react";
import { api } from "../../convex/_generated/api";
import { convex } from "./convex";
import { joinErrorMessage } from "./errors";
import { fullName } from "../../convex/lib/names";
import { COUNTRIES } from "../../convex/lib/countries";
import { LOOKING_FOR } from "../../convex/lib/profile";
import { dobGate, MIN_JOIN_AGE } from "../../convex/lib/joinValidation";
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

type FormValues = {
  firstName: string;
  lastName: string;
  email: string;
  country: string;
  dob: string;
  gender: "female" | "male";
  careerStage: string;
  lookingFor: string[];
  guardianName: string;
  guardianEmail: string;
  attestation: boolean;
  terms: boolean;
  marketing: boolean;
  pipeline: boolean;
  website: string; // honeypot, humans never see it
};

const EMPTY: FormValues = {
  firstName: "",
  lastName: "",
  email: "",
  country: "",
  dob: "",
  gender: "female",
  careerStage: "",
  lookingFor: [],
  guardianName: "",
  guardianEmail: "",
  attestation: false,
  terms: false,
  marketing: false,
  pipeline: false,
  website: "",
};

type Stage = "form" | "confirm" | "sent" | "welcome_back" | "under_13";

function JoinForm() {
  const submitJoin = useAction(api.members.submitJoin);
  const { signIn } = useAuthActions();
  const [values, setValues] = useState<FormValues>(EMPTY);
  const [stage, setStage] = useState<Stage>("form");
  const [token, setToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = <K extends keyof FormValues>(key: K, value: FormValues[K]) =>
    setValues((v) => ({ ...v, [key]: value }));

  const gate = values.dob === "" ? null : dobGate(values.dob, Date.now());
  const isMinor = gate === "minor";

  if (stage === "sent") {
    return (
      <div style={card}>
        <h1 style={h1}>Almost there. Check your email</h1>
        <p style={muted}>
          Welcome to WAI-ME. We sent a confirmation link to{" "}
          <strong style={{ color: "var(--white)" }}>{values.email}</strong>.{" "}
          {isMinor
            ? "Click it to confirm your email. It expires in 15 minutes. Because you are under 18, your membership starts once your parent or guardian confirms it."
            : "Click it to confirm your email and activate your membership. It expires in 15 minutes."}
        </p>
      </div>
    );
  }

  if (stage === "welcome_back") {
    return (
      <div style={card}>
        <h1 style={h1}>Welcome back</h1>
        <p style={muted}>
          You already have a WAI-ME account with{" "}
          <strong style={{ color: "var(--white)" }}>{values.email}</strong>.
          No need to join again, just sign in.
        </p>
        <a href="/portal" style={{ ...primaryBtn, textDecoration: "none", display: "inline-block" }}>
          Sign in
        </a>
      </div>
    );
  }

  if (stage === "under_13") {
    return (
      <div style={card}>
        <h1 style={h1}>Not just yet</h1>
        <p style={muted}>
          Thank you for wanting to join. WAI-ME membership starts at age{" "}
          {MIN_JOIN_AGE}, so we can't sign you up as a member today. We would
          love to welcome you when you turn {MIN_JOIN_AGE}. Until then, a
          parent or guardian is welcome to write to us at{" "}
          <a href="mailto:support@waiorg.me" style={{ color: "var(--sky)" }}>
            support@waiorg.me
          </a>{" "}
          about ways to stay connected.
        </p>
        <button type="button" style={linkBtn} onClick={() => setStage("form")}>
          Back
        </button>
      </div>
    );
  }

  if (stage === "confirm") {
    const certName = fullName(values.firstName, values.lastName);
    return (
      <div style={card}>
        <h1 style={h1}>One last look</h1>
        <p style={muted}>
          Your certificate will read:{" "}
          <strong style={{ color: "var(--white)", fontSize: 18 }}>{certName}</strong>,
          is that correct?
        </p>
        <div style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
          <button
            type="button"
            disabled={busy}
            style={primaryBtn}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                const result = await submitJoin({
                  firstName: values.firstName,
                  lastName: values.lastName,
                  email: values.email.trim().toLowerCase(),
                  country: values.country,
                  lookingFor: values.lookingFor,
                  careerStageAnswer: values.careerStage,
                  genderAnswer: values.gender,
                  dobAnswer: values.dob,
                  attestation: values.attestation,
                  ...(isMinor
                    ? {
                        guardianName: values.guardianName.trim(),
                        guardianEmail: values.guardianEmail.trim().toLowerCase(),
                      }
                    : {}),
                  consents: {
                    terms: values.terms,
                    marketing: values.marketing,
                    pipeline: values.pipeline,
                  },
                  turnstileToken: token ?? "",
                  website: values.website,
                });
                if (result.ok === false) {
                  if (result.error === "under_13") {
                    setStage("under_13");
                  } else if (result.error === "rate_limited") {
                    setError(
                      "We received several sign-ups from this email today, so we have paused new attempts. Please try again tomorrow.",
                    );
                    setStage("form");
                  } else {
                    setError(
                      "Some details didn't look right to us. Please check them and try again.",
                    );
                    setStage("form");
                  }
                  return;
                }
                if ("already" in result && result.already) {
                  setStage("welcome_back");
                  return;
                }
                await signIn("resend", {
                  email: values.email.trim().toLowerCase(),
                  redirectTo: "/portal",
                });
                setStage("sent");
              } catch (err) {
                setError(joinErrorMessage(err));
                setStage("form");
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "Creating your account…" : "Yes, join WAI-ME"}
          </button>
          <button type="button" style={linkBtn} onClick={() => setStage("form")}>
            Edit my name
          </button>
        </div>
        {error !== null && <p style={errorText}>{error}</p>}
      </div>
    );
  }

  return (
    <div style={card}>
      <h1 style={h1}>Join WAI-ME</h1>
      <p style={muted}>
        Membership is free, and it is open to women at any stage, from the
        student with the dream to the captain with the legacy.
      </p>
      <form
        style={{ display: "grid", gap: 14, marginTop: 4 }}
        onSubmit={(event) => {
          event.preventDefault();
          setError(null);
          if (!token) {
            setError("Please complete the verification check.");
            return;
          }
          if (gate === "under_13") {
            setStage("under_13");
            return;
          }
          if (gate === "invalid" || gate === null) {
            setError("Please enter your date of birth.");
            return;
          }
          setStage("confirm");
        }}
      >
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12 }}>
          <label style={label}>
            First name
            <input
              name="firstName"
              type="text"
              required
              maxLength={40}
              autoComplete="given-name"
              value={values.firstName}
              onChange={(e) => set("firstName", e.target.value)}
              style={input}
            />
          </label>
          <label style={label}>
            Last name
            <input
              name="lastName"
              type="text"
              required
              maxLength={40}
              autoComplete="family-name"
              value={values.lastName}
              onChange={(e) => set("lastName", e.target.value)}
              style={input}
            />
          </label>
        </div>

        <label style={label}>
          Email
          <input
            name="email"
            type="email"
            required
            maxLength={254}
            autoComplete="email"
            placeholder="you@example.com"
            value={values.email}
            onChange={(e) => set("email", e.target.value)}
            style={input}
          />
        </label>

        <label style={label}>
          Country
          <select
            name="country"
            required
            value={values.country}
            onChange={(e) => set("country", e.target.value)}
            style={input}
          >
            <option value="" disabled>
              Select your country…
            </option>
            {COUNTRIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>

        <label style={label}>
          Date of birth
          <input
            name="dob"
            type="date"
            required
            value={values.dob}
            onChange={(e) => set("dob", e.target.value)}
            style={input}
          />
        </label>

        {isMinor && (
          <div
            style={{
              display: "grid",
              gap: 12,
              padding: "12px 14px",
              border: "1px solid rgba(255,255,255,0.15)",
              borderRadius: 10,
            }}
          >
            <p style={{ ...muted, margin: 0 }}>
              Because you are under 18, we also need a parent or guardian's
              details. We will ask them to confirm your membership.
            </p>
            <label style={label}>
              Parent or guardian's name
              <input
                name="guardianName"
                type="text"
                required
                maxLength={80}
                value={values.guardianName}
                onChange={(e) => set("guardianName", e.target.value)}
                style={input}
              />
            </label>
            <label style={label}>
              Parent or guardian's email
              <input
                name="guardianEmail"
                type="email"
                required
                maxLength={254}
                value={values.guardianEmail}
                onChange={(e) => set("guardianEmail", e.target.value)}
                style={input}
              />
            </label>
          </div>
        )}

        <fieldset style={{ border: "none", padding: 0, margin: 0, ...label }}>
          <span>Gender</span>
          <div style={{ display: "flex", gap: 18, color: "var(--white)" }}>
            <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <input
                type="radio"
                name="gender"
                value="female"
                checked={values.gender === "female"}
                onChange={() => set("gender", "female")}
              />{" "}
              Female
            </label>
            <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <input
                type="radio"
                name="gender"
                value="male"
                checked={values.gender === "male"}
                onChange={() => {
                  // The women-only pipeline option hides for male applicants;
                  // clear any earlier tick so a hidden consent never submits.
                  set("gender", "male");
                  set("pipeline", false);
                }}
              />{" "}
              Male
            </label>
          </div>
        </fieldset>

        <label style={label}>
          Where are you in aviation right now?
          <select
            name="careerStage"
            required
            value={values.careerStage}
            onChange={(e) => set("careerStage", e.target.value)}
            style={input}
          >
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

        <fieldset style={{ border: "none", padding: 0, margin: 0, ...label }}>
          <span>What are you hoping we help you with? (pick any)</span>
          <div style={{ display: "grid", gap: 6, color: "var(--white)" }}>
            {/* Safeguarding: mentorship is not available to members under 18,
                so those options are never offered to them. */}
            {LOOKING_FOR.filter(
              (option) => !isMinor || !option.toLowerCase().includes("mentor"),
            ).map((option) => (
              <label
                key={option}
                style={{ display: "flex", gap: 8, alignItems: "center", fontWeight: 400 }}
              >
                <input
                  type="checkbox"
                  checked={values.lookingFor.includes(option)}
                  onChange={() =>
                    set(
                      "lookingFor",
                      values.lookingFor.includes(option)
                        ? values.lookingFor.filter((o) => o !== option)
                        : [...values.lookingFor, option],
                    )
                  }
                />
                {option}
              </label>
            ))}
          </div>
        </fieldset>

        {/* Honeypot: hidden from humans and screen readers; naive bots fill
            every input in the DOM regardless. */}
        <div aria-hidden="true" style={{ display: "none" }}>
          <label>
            Website
            <input
              name="website"
              type="text"
              tabIndex={-1}
              autoComplete="off"
              value={values.website}
              onChange={(e) => set("website", e.target.value)}
            />
          </label>
        </div>

        <label style={checkboxRow}>
          <input
            type="checkbox"
            name="terms"
            required
            checked={values.terms}
            onChange={(e) => set("terms", e.target.checked)}
          />
          <span>
            I agree to the WAI-ME terms and privacy policy. (required)
          </span>
        </label>
        <label style={checkboxRow}>
          <input
            type="checkbox"
            name="attestation"
            required
            checked={values.attestation}
            onChange={(e) => set("attestation", e.target.checked)}
          />
          <span>
            I confirm my details, including age and gender, are accurate.
            (required)
          </span>
        </label>
        <label style={checkboxRow}>
          <input
            type="checkbox"
            name="marketing"
            checked={values.marketing}
            onChange={(e) => set("marketing", e.target.checked)}
          />
          <span>Email me about events, opportunities and news. (optional)</span>
        </label>
        {/* The talent pipeline is women-only and never offered to minors
            (Stage 0 lane rules): the option renders only for adult female
            applicants, so no one is shown a consent the server would refuse.
            The server enforces the same rule whatever the client sends. */}
        {!isMinor && values.gender === "female" && (
          <label style={checkboxRow}>
            <input
              type="checkbox"
              name="pipeline"
              checked={values.pipeline}
              onChange={(e) => set("pipeline", e.target.checked)}
            />
            <span>
              Make my profile searchable by corporate partners with jobs,
              internships and scholarships. You can change this anytime.
              (optional)
            </span>
          </label>
        )}

        <Turnstile onToken={setToken} />

        <button type="submit" disabled={busy} style={primaryBtn}>
          Continue
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
          // Clear a stale token client-side so the member re-verifies instead
          // of hitting a confusing server rejection.
          "expired-callback": () => onToken(""),
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
