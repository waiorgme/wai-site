import { useEffect, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { useAuthActions } from "@convex-dev/auth/react";
import { api } from "../../convex/_generated/api";
import { ClaimFlow } from "./ClaimFlow";
import { ProfileEditor } from "./ProfileEditor";
import { Settings } from "./Settings";
import { YourData } from "./YourData";
import {
  MembershipCertificate,
  ScaledCertificate,
} from "../certificate/MembershipCertificate";
import { h1, linkBtn, muted, panel, primaryBtn } from "./ui";
import type { CSSProperties } from "react";

type MemberView = ReturnType<typeof useQuery<typeof api.members.getCurrentMember>>;
type CertsView = ReturnType<
  typeof useQuery<typeof api.certificates.getMyCertificates>
>;
type MembershipCertView = NonNullable<CertsView>[number] | null;

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
  const [editing, setEditing] = useState(false);
  const [choosing, setChoosing] = useState(false);

  const isActive = me != null && me.lifecycle_state === "active";
  const isMinorLane =
    me != null &&
    (me.member_lane === "minor" || me.member_lane === "restricted_unknown");

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

  // An ACTIVE member under 18 gets the youth dashboard (Under-18 Launch Copy
  // §2, verbatim): her certificate plus the Aviation for Girls home base, in
  // place of the adult tiles. Nothing the protected experience excludes
  // (mentoring, directory, pipeline, settings toggles) is rendered; the
  // servers refuse them too.
  if (isActive && me?.member_lane === "minor") {
    return (
      <>
        <Hero
          heading="Welcome to Women in Aviation Middle East."
          intro="You're part of a regional community of women and girls who love aviation, and your journey starts here."
          name={me?.name}
          membershipCert={membershipCert}
          onSignOut={() => void signOut()}
        />
        <div className="pn-main">
          <div className="pn-main-inner" style={maxw}>
            <CertificateSection
              me={me}
              certs={certs}
              isActive={isActive}
              membershipCert={membershipCert}
            />

            <section className="pn-card">
              <span className="pn-eyebrow on-paper">Your home base</span>
              <p className={muted}>
                {"As a member under 18, your home base is "}
                <strong>Aviation for Girls</strong>
                {", the youth program run by our parent organisation, Women in Aviation International. It's made for you, and it's free:"}
              </p>
              <ul
                className={muted}
                style={{ paddingInlineStart: 20, display: "grid", gap: 6 }}
              >
                <li>
                  <strong>The Aviation for Girls app:</strong>{" "}
                  aviation content, activities, and stories from women already
                  flying, building, and leading.
                </li>
                <li>
                  <strong>AFG Engage:</strong>{" "}
                  online lessons that introduce aviation and aerospace careers,
                  step by step.
                </li>
                <li>
                  <strong>AFG Connect News</strong>
                  {" and the annual "}
                  <strong>Aviation for Girls magazine</strong>
                  {", stories, opportunities, and people to look up to."}
                </li>
                <li>
                  <strong>Girls in Aviation Day:</strong>{" "}
                  a global event you can take part in.
                </li>
              </ul>
              <div className="pn-actions">
                <a
                  href="https://www.wai.org/youth-education"
                  target="_blank"
                  rel="noopener"
                  className={primaryBtn}
                >
                  Explore Aviation for Girls →
                </a>
              </div>
              <p className={muted}>
                When you turn 18, your WAI-ME membership opens up fully, mentoring,
                events, opportunities, and the wider network. Until then, this is
                your runway. We're glad you're here.
              </p>
            </section>

            {/* Data rights apply to under-18 members too (they are not behind the
                adult-only choices panel a minor never sees). */}
            <section className="pn-card">
              <YourData compact />
            </section>
          </div>
        </div>
      </>
    );
  }

  if (editing) {
    return (
      <div className="pn-center">
        <Brand />
        <div className={panel}>
          <h1 className={h1}>Your profile</h1>
          <p className={muted}>
            The more you add, the better we can match you to opportunities, events
            and people. Nothing is required, so add what you like, anytime.
          </p>
          <ProfileEditor
            onClose={() => setEditing(false)}
            hideMentorship={isMinorLane}
          />
        </div>
      </div>
    );
  }

  if (choosing) {
    return (
      <div className="pn-center">
        <Brand />
        <div className={panel}>
          <h1 className={h1}>Your choices</h1>
          <p className={muted}>
            Who can find you, and how. Both are off unless you turn them on, and
            you can change your mind anytime.
          </p>
          <Settings onClose={() => setChoosing(false)} />
        </div>
      </div>
    );
  }

  return (
    <>
      <Hero
        heading={`Welcome to WAI-ME${firstName ? `, ${firstName}` : ""}`}
        intro="You're a member. Here's your certificate to start, your first of many wins as part of the community."
        name={me?.name}
        membershipCert={membershipCert}
        onSignOut={() => void signOut()}
      />
      <div className="pn-main">
        <div className="pn-main-inner" style={maxw}>
          <CertificateSection
            me={me}
            certs={certs}
            isActive={isActive}
            membershipCert={membershipCert}
          />

          <div className="pn-grid">
            <Tile title="Your profile">
              <p className="pn-meta">
                {me?.profile_complete
                  ? "Your profile is complete. Keep it fresh as you grow."
                  : "Add a few details so we can match you to the right opportunities and people."}
              </p>
              <button type="button" className={linkBtn} onClick={() => setEditing(true)}>
                {me?.profile_complete ? "Edit profile" : "Complete your profile"}
              </button>
            </Tile>

            <Tile title="Your standing">
              <p className="pn-meta">
                You're a <strong>Member</strong>.
                Take part by attending an event, sharing a resource, or helping
                someone, and you become an Active Member.
              </p>
            </Tile>

            <Tile title="Your choices">
              <p className="pn-meta">
                Choose whether other members can find you, and whether trusted
                partners can match you to opportunities.
              </p>
              <button type="button" className={linkBtn} onClick={() => setChoosing(true)}>
                Manage my choices
              </button>
            </Tile>

            <Tile title="Opportunities" soon>
              <p className="pn-meta">
                Scholarships, jobs and training matched to you. Coming soon.
              </p>
            </Tile>

            <Tile title="Events" soon>
              <p className="pn-meta">
                Workshops and meetups you can RSVP to. Coming soon.
              </p>
            </Tile>

            <Tile title="Your circle" soon>
              <p className="pn-meta">
                Women one step ahead, by stage and country. Coming soon.
              </p>
            </Tile>
          </div>
        </div>
      </div>
    </>
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

// The navy hero band for the signed-in dashboards (locked dashboard shape):
// brand bar with the only Sign out on the screen, mono eyebrow, welcome
// heading, and the glass member ID strip. Facts on the strip come from data
// already on screen elsewhere (name, membership number, issue-year).
function Hero({
  heading,
  intro,
  name,
  membershipCert,
  onSignOut,
}: {
  heading: string;
  intro: string;
  name: string | undefined;
  membershipCert: MembershipCertView;
  onSignOut: () => void;
}) {
  // Year of issue, read from the certificate's own date label ("12 June 2026").
  // Labelled "Certificate issued", never "member since": a claimed legacy
  // member's certificate is issued at claim time, not when she first joined.
  const issuedYear =
    membershipCert?.issued_date_label.match(/\b\d{4}\b/)?.[0] ?? null;
  return (
    <div className="pn-hero">
      <div className="pn-hero-inner" style={maxw}>
        <div className="pn-bar">
          <img
            src="/assets/wai-me-logo-on-dark.png"
            alt="Women in Aviation Middle East"
          />
          <button type="button" className={linkBtn} onClick={onSignOut}>
            Sign out
          </button>
        </div>
        <p className="pn-eyebrow">Member portal</p>
        <h1 className="pn-h1">{heading}</h1>
        <p className={muted}>{intro}</p>
        <div className="pn-glass">
          <div className="cell">
            <span className="label">Name</span>
            <span className="value">{name}</span>
          </div>
          <div className="cell">
            <span className="label">Standing</span>
            <span className="value">Member</span>
          </div>
          {membershipCert !== null && (
            <div className="cell">
              <span className="label">Membership number</span>
              <span className="value">WAIME-{membershipCert.membership_number}</span>
            </div>
          )}
          {issuedYear !== null && (
            <div className="cell">
              <span className="label">Certificate issued</span>
              <span className="value">{issuedYear}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// The certificate card, shared by the adult and youth dashboards.
function CertificateSection({
  me,
  certs,
  isActive,
  membershipCert,
}: {
  me: MemberView;
  certs: CertsView;
  isActive: boolean;
  membershipCert: MembershipCertView;
}) {
  return (
    <section className="pn-card">
      <div className="pn-bar">
        <span className="pn-eyebrow on-paper">Your membership certificate</span>
        {membershipCert?.is_founding && (
          <span className="pn-gold-badge">Founding Member</span>
        )}
      </div>

      {me === undefined || certs === undefined ? (
        <p className={muted}>Loading…</p>
      ) : membershipCert === null ? (
        <p className={muted}>
          {isActive
            ? "Preparing your certificate…"
            : me?.lifecycle_state === "pending_review"
              ? "Thanks for confirming your email. A team member is reviewing your details. This page will update as soon as your membership is confirmed."
              : me?.lifecycle_state === "pending_guardian"
                ? "Thanks for confirming your email. Because you are under 18, we have emailed your parent or guardian to confirm your membership."
                : "Your certificate is issued once your email is confirmed."}
        </p>
      ) : (
        <>
          <ScaledCertificate>
            <MembershipCertificate
              recipientName={membershipCert.recipient_name}
              membershipNumber={membershipCert.membership_number}
              certId={`WAIME-MEM-${membershipCert.membership_number}`}
              dateLabel={membershipCert.issued_date_label}
              isFounding={membershipCert.is_founding}
              verifyUrl={verifyUrlFor(membershipCert.verify_token)}
            />
          </ScaledCertificate>
          <div className="pn-actions">
            <a
              href={`/verify?id=${membershipCert.verify_token}`}
              target="_blank"
              rel="noopener"
              className={primaryBtn}
            >
              View &amp; verify
            </a>
            <ShareButton token={membershipCert.verify_token} />
            <span className="pn-meta pn-mono">
              Membership Number WAIME-{membershipCert.membership_number}
            </span>
          </div>
        </>
      )}
    </section>
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

function ShareButton({ token }: { token: string }) {
  const [done, setDone] = useState(false);
  const onShare = async () => {
    const url = verifyUrlFor(token);
    const text = `Proud to join Women in Aviation Middle East! ${url}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: "Women in Aviation Middle East", text, url });
      } else {
        await navigator.clipboard.writeText(text);
        setDone(true);
        setTimeout(() => setDone(false), 2000);
      }
    } catch {
      /* user dismissed the share sheet, nothing to do */
    }
  };
  // The label doubles as the copied-link feedback, so it lives in a status
  // region inside the button (the button keeps its role and accessible name).
  return (
    <button type="button" className={linkBtn} onClick={() => void onShare()}>
      <span role="status">{done ? "Link copied ✓" : "Share"}</span>
    </button>
  );
}

// Live tiles are white cards; coming-soon tiles are dashed reserved slots
// (the honest "Soon" state: visibly not live, no hover lift, not clickable).
function Tile({
  title,
  soon,
  children,
}: {
  title: string;
  soon?: boolean;
  children: React.ReactNode;
}) {
  if (soon) {
    return (
      <div className="pn-slot">
        <span className="pn-soon">Soon</span>
        <p className="pn-name">{title}</p>
        {children}
      </div>
    );
  }
  return (
    <div className="pn-card">
      <h2 className="pn-sectitle">{title}</h2>
      {children}
    </div>
  );
}

const verifyUrlFor = (token: string): string =>
  typeof window === "undefined"
    ? `/verify?id=${token}`
    : `${window.location.origin}/verify?id=${token}`;

// The dashboard column width (design direction: portal 1040px).
const maxw = { "--pn-maxw": "1040px" } as CSSProperties;
