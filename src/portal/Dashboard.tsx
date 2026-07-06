import { useEffect, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { useAuthActions } from "@convex-dev/auth/react";
import { api } from "../../convex/_generated/api";
import { ClaimFlow } from "./ClaimFlow";
import { YourData } from "./YourData";
import { PortalShell } from "./PortalShell";
import { h1, linkBtn, muted, panel } from "./ui";

export function Dashboard() {
  const { signOut } = useAuthActions();
  const me = useQuery(api.members.getCurrentMember);
  const certs = useQuery(api.certificates.getMyCertificates);
  const claim = useQuery(api.members.getMyClaimCandidate, me === null ? {} : "skip");
  const guardianStatus = useQuery(
    api.guardians.myGuardianEmailStatus,
    me?.lifecycle_state === "pending_guardian" ? {} : "skip",
  );
  const ensureCert = useMutation(api.certificates.ensureMyMembershipCertificate);

  const isActive = me != null && me.lifecycle_state === "active";

  // Make sure an active member has her certificate (covers members who became
  // active before the engine existed). Idempotent server-side. Minors at
  // pending_guardian are not active, so they don't trigger issuance here.
  useEffect(() => {
    if (isActive && certs !== undefined && certs.length === 0) {
      void ensureCert({});
    }
  }, [isActive, certs, ensureCert]);

  const firstName = me?.name?.split(" ")[0];
  const membershipCert = certs?.find((c) => c.type === "membership") ?? null;

  // Never flash the member dashboard while the member row or the claim
  // candidate is still resolving.
  if (me === undefined || (me === null && claim === undefined)) {
    return (
      <div className="pn-center">
        <Brand />
        <div className={panel}>
          <p className={muted}>Loading…</p>
        </div>
      </div>
    );
  }

  // Signed in, but no member row AND no imported record: an honest no-member
  // state, never the member dashboard (Gate 4: an unlinked authenticated user
  // must not be told "You're a member").
  if (me === null && claim === null) {
    return (
      <div className="pn-center">
        <Brand />
        <div className={panel}>
          <h1 className={h1}>We couldn't find your membership</h1>
          <p className={muted}>
            This email address isn't linked to a WAI-ME membership. If you joined
            with a different address, sign out and use that one. If you think
            this is a mistake, write to us at{" "}
            <a href="mailto:support@waiorg.me">support@waiorg.me</a>{" "}
            and we will sort it out.
          </p>
          <button type="button" className={linkBtn} onClick={() => void signOut()}>
            Sign out
          </button>
        </div>
      </div>
    );
  }

  // Migrated member, signed in but not yet claimed: the claim step IS her
  // dashboard until it completes (Migration & Claim-Wave Plan, Decision 1).
  // ClaimFlow renders its own card; this provides the centered scaffold.
  if (me === null && claim != null && claim.state === "claimable") {
    return (
      <div className="pn-center">
        <Brand />
        <ClaimFlow
          candidateName={claim.name}
          hasDobOnFile={claim.has_dob_on_file}
          genderOnFile={claim.gender_on_file}
        />
      </div>
    );
  }
  if (me === null && claim != null && claim.state === "held") {
    return (
      <div className="pn-center">
        <Brand />
        <div className={panel}>
          <h1 className={h1}>Almost there</h1>
          <p className={muted}>
            Your record needs a quick look from our team before it opens. We will
            email you at this address. If you think that's a mistake, write to us
            at <a href="mailto:support@waiorg.me">support@waiorg.me</a>.
          </p>
        </div>
      </div>
    );
  }

  // Safeguarding: until the account is `active`, the portal shows ONLY the
  // waiting state. A pending_guardian minor (or pending_review unknown-age
  // account) gets no profile editor, no tiles, no member surfaces; the server
  // enforces the same rule on every mutation, this is the honest UI for it.
  if (me != null && !isActive) {
    return (
      <div className="pn-center">
        <Brand />
        <div className={panel}>
          <h1 className={h1}>
            Almost there{firstName ? `, ${firstName}` : ""}
          </h1>
          <p className={muted}>
            {me.lifecycle_state === "pending_guardian"
              ? guardianStatus?.sent
                ? "Thanks for confirming your email. Because you are under 18, we have emailed your parent or guardian to confirm your membership. Ask them to check their inbox; your membership, certificate and profile open up the moment they press confirm."
                : "Thanks for confirming your email. Because you are under 18, a parent or guardian needs to confirm your membership; we are preparing their email now. If nothing arrives within a few minutes, press the button below to send it."
              : me.lifecycle_state === "pending_review"
                ? "Thanks for confirming your email. A team member is reviewing your details. This page will update as soon as your membership is confirmed."
                : "Please confirm your email first. Check your inbox for the link we sent you."}
          </p>
          {me.lifecycle_state === "pending_guardian" && <GuardianResend />}
        </div>
        {/* Data rights apply in every state, including while waiting on a
            guardian or a review (vault Privacy & Data Protection). */}
        <section className={panel}>
          <YourData compact />
        </section>
        <button type="button" className={linkBtn} onClick={() => void signOut()}>
          Sign out
        </button>
      </div>
    );
  }

  // Everything below is an ACTIVE member: the ladder above returned for every
  // other state. TypeScript can't see that across the claim union, so guard.
  if (me === null) {
    return null;
  }

  // An ACTIVE member under 18 gets the youth shell (Under-18 Launch Copy §2):
  // the reduced nav, the AFG home base as Home (copy unchanged), and
  // youth-audience events only. Nothing the protected experience excludes
  // (mentoring, directory, opportunities, pipeline, settings toggles) is
  // rendered; the servers refuse them too.
  if (me.member_lane === "minor") {
    return (
      <PortalShell
        lane="youth"
        me={me}
        certs={certs}
        membershipCert={membershipCert}
        onSignOut={() => void signOut()}
      />
    );
  }

  // Active adults (standard/ally) and restricted-unknown accounts get the
  // full workspace shell; restricted surfaces stay locked inside it with
  // plain words, mirroring the servers.
  return (
    <PortalShell
      lane="full"
      me={me}
      certs={certs}
      membershipCert={membershipCert}
      onSignOut={() => void signOut()}
    />
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

// "Send it again" on the pending-guardian waiting panel. An ACTION whose
// reply reflects what actually happened: "Sent" only after Resend accepted
// the email. The server throttles (1/hour, 3/day) and rotates the token.
function GuardianResend() {
  const resend = useAction(api.guardians.resendGuardianEmail);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div className="pn-stack">
      <button
        type="button"
        className={linkBtn}
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setMessage(null);
          try {
            const res = await resend({});
            setMessage(
              res.ok
                ? "Sent. Ask your parent or guardian to check their inbox, including spam."
                : res.error === "rate_limited"
                  ? "We sent that email recently. Please wait an hour before sending it again."
                  : "We couldn't send that just now. Please try again later or email support@waiorg.me.",
            );
          } catch {
            setMessage(
              "We couldn't send that just now. Please try again later or email support@waiorg.me.",
            );
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "Sending…" : "Send the guardian email again"}
      </button>
      {message !== null && (
        <p className="pn-meta" role="status">
          {message}
        </p>
      )}
    </div>
  );
}
