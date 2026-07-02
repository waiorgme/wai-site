import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { ageInYears, isValidDob } from "../../convex/lib/age";
import {
  card,
  checkboxRow,
  errorText,
  h1,
  input,
  label,
  muted,
  primaryBtn,
} from "./ui";

// The claim step for the 1,309 migrated members (Migration & Claim-Wave Plan,
// Decision 1): she signed in with a fresh magic link, which proved she owns
// the email; here she confirms her details and consents, and her imported
// record becomes her live membership. Plain language throughout.

export function ClaimFlow({ candidateName, hasDobOnFile, genderOnFile }: {
  candidateName: string;
  hasDobOnFile: boolean;
  genderOnFile: "female" | "male" | null;
}) {
  const matchClaim = useMutation(api.members.matchClaim);
  const [name, setName] = useState(candidateName);
  const [dob, setDob] = useState("");
  const [gender, setGender] = useState<"female" | "male">(genderOnFile ?? "female");
  const [terms, setTerms] = useState(false);
  const [attestation, setAttestation] = useState(false);
  const [marketing, setMarketing] = useState(false);
  const [pipeline, setPipeline] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<null | "conflict" | "minor">(null);

  const firstName = candidateName.split(" ")[0];

  // The talent pipeline is women-only and never offered to minors (Stage 0
  // lane rules, same as the join form): the option renders only when the
  // declared gender is female and the declared DOB is not under 18. The
  // server enforces the same rule whatever the client sends.
  const declaredMinor =
    dob !== "" && isValidDob(dob, Date.now()) && ageInYears(dob, Date.now()) < 18;
  const showPipeline = gender === "female" && !declaredMinor;

  if (outcome === "conflict") {
    return (
      <div style={card}>
        <h1 style={h1}>One detail needs a human look</h1>
        <p style={muted}>
          Thanks, {firstName}. The date of birth you entered doesn't match what
          we have on file from before, so a team member will check your record
          and email you at this address to sort it out. Nothing is wrong with
          your membership; this is just us being careful with your details.
        </p>
      </div>
    );
  }

  if (outcome === "minor") {
    return (
      <div style={card}>
        <h1 style={h1}>One extra step, because you are under 18</h1>
        <p style={muted}>
          Welcome back, {firstName}. Because you are under 18, a parent or
          guardian needs to confirm your membership before your account opens.
          Our team will contact you by email to arrange that step.
        </p>
      </div>
    );
  }

  return (
    <div style={card}>
      <h1 style={h1}>Welcome back, {firstName}</h1>
      <p style={muted}>
        You're already on our member list. Confirm a few details and your
        membership moves to the new WAI-ME home, including your membership
        certificate.
      </p>
      <form
        style={{ display: "grid", gap: 14, marginTop: 4 }}
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          setError(null);
          try {
            const result = await matchClaim({
              nameConfirmed: name,
              dobAnswer: dob,
              genderAnswer: gender,
              attestation,
              consents: {
                terms,
                marketing,
                pipeline: showPipeline ? pipeline : false,
              },
            });
            if (result.ok === false) {
              if (result.error === "conflict") {
                setOutcome("conflict");
              } else if (result.error === "minor") {
                setOutcome("minor");
              } else {
                setError("Some details didn't look right to us. Please check them and try again.");
              }
            }
            // On success the dashboard re-renders from the live query.
          } catch {
            setError("Something went wrong. Please try again.");
          } finally {
            setBusy(false);
          }
        }}
      >
        <label style={label}>
          Your name, as it will appear on your certificate
          <input
            type="text"
            required
            maxLength={90}
            value={name}
            onChange={(e) => setName(e.target.value)}
            style={input}
          />
        </label>

        <fieldset style={{ border: "none", padding: 0, margin: 0, ...label }}>
          <span>Gender</span>
          <div style={{ display: "flex", gap: 18, color: "var(--white)" }}>
            <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <input
                type="radio"
                name="claim-gender"
                value="female"
                checked={gender === "female"}
                onChange={() => setGender("female")}
              />{" "}
              Female
            </label>
            <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <input
                type="radio"
                name="claim-gender"
                value="male"
                checked={gender === "male"}
                onChange={() => {
                  // The women-only pipeline option hides for male claims;
                  // clear any earlier tick so a hidden consent never submits.
                  setGender("male");
                  setPipeline(false);
                }}
              />{" "}
              Male
            </label>
          </div>
        </fieldset>

        <label style={label}>
          Date of birth
          {hasDobOnFile && (
            <span style={{ ...muted, fontSize: 13, fontWeight: 400 }}>
              We check this against the record we already hold, to make sure
              it's really you.
            </span>
          )}
          <input
            type="date"
            required
            value={dob}
            onChange={(e) => setDob(e.target.value)}
            style={input}
          />
        </label>

        <label style={checkboxRow}>
          <input type="checkbox" required checked={terms} onChange={(e) => setTerms(e.target.checked)} />
          <span>I agree to the WAI-ME terms and privacy policy. (required)</span>
        </label>
        <label style={checkboxRow}>
          <input type="checkbox" required checked={attestation} onChange={(e) => setAttestation(e.target.checked)} />
          <span>I confirm my details, including age and gender, are accurate. (required)</span>
        </label>
        <label style={checkboxRow}>
          <input type="checkbox" checked={marketing} onChange={(e) => setMarketing(e.target.checked)} />
          <span>Email me about events, opportunities and news. (optional)</span>
        </label>
        {showPipeline && (
          <label style={checkboxRow}>
            <input type="checkbox" checked={pipeline} onChange={(e) => setPipeline(e.target.checked)} />
            <span>
              Make my profile searchable by corporate partners with jobs,
              internships and scholarships. You can change this anytime. (optional)
            </span>
          </label>
        )}

        <button type="submit" disabled={busy} style={primaryBtn}>
          {busy ? "Claiming your membership…" : "Claim my membership"}
        </button>
        {error !== null && <p style={errorText}>{error}</p>}
      </form>
    </div>
  );
}
