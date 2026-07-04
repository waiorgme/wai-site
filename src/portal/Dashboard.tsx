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
import { card, h1, linkBtn, muted, panel, primaryBtn } from "./ui";
import type { CSSProperties } from "react";

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
      <div style={panel}>
        <p style={muted}>Loading…</p>
      </div>
    );
  }

  // Signed in, but no member row AND no imported record: an honest no-member
  // state, never the member dashboard (Gate 4: an unlinked authenticated user
  // must not be told "You're a member").
  if (me === null && claim === null) {
    return (
      <div style={panel}>
        <h1 style={h1}>We couldn't find your membership</h1>
        <p style={muted}>
          This email address isn't linked to a WAI-ME membership. If you joined
          with a different address, sign out and use that one. If you think
          this is a mistake, write to us at{" "}
          <a href="mailto:support@waiorg.me" style={{ color: "var(--sky)" }}>
            support@waiorg.me
          </a>{" "}
          and we will sort it out.
        </p>
        <button type="button" style={linkBtn} onClick={() => void signOut()}>
          Sign out
        </button>
      </div>
    );
  }

  // Migrated member, signed in but not yet claimed: the claim step IS her
  // dashboard until it completes (Migration & Claim-Wave Plan, Decision 1).
  if (me === null && claim != null && claim.state === "claimable") {
    return (
      <ClaimFlow
        candidateName={claim.name}
        hasDobOnFile={claim.has_dob_on_file}
        genderOnFile={claim.gender_on_file}
      />
    );
  }
  if (me === null && claim != null && claim.state === "held") {
    return (
      <div style={panel}>
        <h1 style={h1}>Almost there</h1>
        <p style={muted}>
          Your record needs a quick look from our team before it opens. We will
          email you at this address. If you think that's a mistake, write to us
          at{" "}
          <a href="mailto:support@waiorg.me" style={{ color: "var(--sky)" }}>
            support@waiorg.me
          </a>
          .
        </p>
      </div>
    );
  }

  // Safeguarding: until the account is `active`, the portal shows ONLY the
  // waiting state. A pending_guardian minor (or pending_review unknown-age
  // account) gets no profile editor, no tiles, no member surfaces; the server
  // enforces the same rule on every mutation, this is the honest UI for it.
  if (me != null && !isActive) {
    return (
      <div style={wrap}>
        <header style={{ display: "grid", gap: 6 }}>
          <h1 style={{ ...h1, fontSize: 30 }}>
            Almost there{firstName ? `, ${firstName}` : ""}
          </h1>
          <p style={muted}>
            {me.lifecycle_state === "pending_guardian"
              ? guardianStatus?.sent
                ? "Thanks for confirming your email. Because you are under 18, we have emailed your parent or guardian to confirm your membership. Ask them to check their inbox; your membership, certificate and profile open up the moment they press confirm."
                : "Thanks for confirming your email. Because you are under 18, a parent or guardian needs to confirm your membership; we are preparing their email now. If nothing arrives within a few minutes, press the button below to send it."
              : me.lifecycle_state === "pending_review"
                ? "Thanks for confirming your email. A team member is reviewing your details. This page will update as soon as your membership is confirmed."
                : "Please confirm your email first. Check your inbox for the link we sent you."}
          </p>
        </header>
        {me.lifecycle_state === "pending_guardian" && <GuardianResend />}
        {/* Data rights apply in every state, including while waiting on a
            guardian or a review (vault Privacy & Data Protection). */}
        <section style={{ ...card, width: "100%" }}>
          <YourData compact />
        </section>
        <button type="button" style={linkBtn} onClick={() => void signOut()}>
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
      <div style={wrap}>
        <header style={{ display: "grid", gap: 6 }}>
          <h1 style={{ ...h1, fontSize: 30 }}>
            Welcome to Women in Aviation Middle East.
          </h1>
          <p style={muted}>
            You're part of a regional community of women and girls who love
            aviation, and your journey starts here.
          </p>
        </header>

        <CertificateSection
          me={me}
          certs={certs}
          isActive={isActive}
          membershipCert={membershipCert}
        />

        <section style={{ ...card, width: "100%" }}>
          <div style={cardHead}>
            <span style={eyebrow}>Your home base</span>
          </div>
          <p style={tileBody}>
            {"As a member under 18, your home base is "}
            <strong style={{ color: "var(--white)" }}>Aviation for Girls</strong>
            {", the youth program run by our parent organisation, Women in Aviation International. It's made for you, and it's free:"}
          </p>
          <ul style={{ ...tileBody, margin: 0, paddingInlineStart: 20, display: "grid", gap: 6 }}>
            <li>
              <strong style={{ color: "var(--white)" }}>The Aviation for Girls app:</strong>{" "}
              aviation content, activities, and stories from women already
              flying, building, and leading.
            </li>
            <li>
              <strong style={{ color: "var(--white)" }}>AFG Engage:</strong>{" "}
              online lessons that introduce aviation and aerospace careers,
              step by step.
            </li>
            <li>
              <strong style={{ color: "var(--white)" }}>AFG Connect News</strong>
              {" and the annual "}
              <strong style={{ color: "var(--white)" }}>Aviation for Girls magazine</strong>
              {", stories, opportunities, and people to look up to."}
            </li>
            <li>
              <strong style={{ color: "var(--white)" }}>Girls in Aviation Day:</strong>{" "}
              a global event you can take part in.
            </li>
          </ul>
          <a
            href="https://www.wai.org/youth-education"
            target="_blank"
            rel="noopener"
            style={{ ...primaryBtn, textDecoration: "none", display: "inline-block", justifySelf: "start" }}
          >
            Explore Aviation for Girls →
          </a>
          <p style={tileBody}>
            When you turn 18, your WAI-ME membership opens up fully, mentoring,
            events, opportunities, and the wider network. Until then, this is
            your runway. We're glad you're here.
          </p>
        </section>

        {/* Data rights apply to under-18 members too (they are not behind the
            adult-only choices panel a minor never sees). */}
        <section style={{ ...card, width: "100%" }}>
          <YourData compact />
        </section>

        <button type="button" style={linkBtn} onClick={() => void signOut()}>
          Sign out
        </button>
      </div>
    );
  }

  if (editing) {
    return (
      <div style={panel}>
        <h1 style={h1}>Your profile</h1>
        <p style={muted}>
          The more you add, the better we can match you to opportunities, events
          and people. Nothing is required, so add what you like, anytime.
        </p>
        <ProfileEditor
          onClose={() => setEditing(false)}
          hideMentorship={isMinorLane}
        />
      </div>
    );
  }

  if (choosing) {
    return (
      <div style={panel}>
        <h1 style={h1}>Your choices</h1>
        <p style={muted}>
          Who can find you, and how. Both are off unless you turn them on, and
          you can change your mind anytime.
        </p>
        <Settings onClose={() => setChoosing(false)} />
      </div>
    );
  }

  return (
    <div style={wrap}>
      <header style={{ display: "grid", gap: 6 }}>
        <h1 style={{ ...h1, fontSize: 30 }}>
          Welcome to WAI-ME{firstName ? `, ${firstName}` : ""}
        </h1>
        <p style={muted}>
          You're a member. Here's your certificate to start, your first of many
          wins as part of the community.
        </p>
      </header>

      <CertificateSection
        me={me}
        certs={certs}
        isActive={isActive}
        membershipCert={membershipCert}
      />

      <div style={grid}>
        <Tile title="Your profile">
          <p style={tileBody}>
            {me?.profile_complete
              ? "Your profile is complete. Keep it fresh as you grow."
              : "Add a few details so we can match you to the right opportunities and people."}
          </p>
          <button type="button" style={linkBtn} onClick={() => setEditing(true)}>
            {me?.profile_complete ? "Edit profile" : "Complete your profile"}
          </button>
        </Tile>

        <Tile title="Your standing">
          <p style={tileBody}>
            You're a <strong style={{ color: "var(--white)" }}>Member</strong>.
            Take part by attending an event, sharing a resource, or helping
            someone, and you become an Active Member.
          </p>
        </Tile>

        <Tile title="Your choices">
          <p style={tileBody}>
            Choose whether other members can find you, and whether trusted
            partners can match you to opportunities.
          </p>
          <button type="button" style={linkBtn} onClick={() => setChoosing(true)}>
            Manage my choices
          </button>
        </Tile>

        <Tile title="Opportunities" soon>
          <p style={tileBody}>
            Scholarships, jobs and training matched to you. Coming soon.
          </p>
        </Tile>

        <Tile title="Events" soon>
          <p style={tileBody}>
            Workshops and meetups you can RSVP to. Coming soon.
          </p>
        </Tile>

        <Tile title="Your circle" soon>
          <p style={tileBody}>
            Women one step ahead, by stage and country. Coming soon.
          </p>
        </Tile>
      </div>

      <button type="button" style={linkBtn} onClick={() => void signOut()}>
        Sign out
      </button>
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
  me: ReturnType<typeof useQuery<typeof api.members.getCurrentMember>>;
  certs: ReturnType<typeof useQuery<typeof api.certificates.getMyCertificates>>;
  isActive: boolean;
  membershipCert:
    | NonNullable<
        ReturnType<typeof useQuery<typeof api.certificates.getMyCertificates>>
      >[number]
    | null;
}) {
  return (
    <section style={{ ...card, width: "100%" }}>
      <div style={cardHead}>
        <span style={eyebrow}>Your membership certificate</span>
        {membershipCert?.is_founding && (
          <span style={badge}>Founding Member</span>
        )}
      </div>

      {me === undefined || certs === undefined ? (
        <p style={muted}>Loading…</p>
      ) : membershipCert === null ? (
        <p style={muted}>
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
          <div style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "center" }}>
            <a
              href={`/verify?id=${membershipCert.verify_token}`}
              target="_blank"
              rel="noopener"
              style={{ ...primaryBtn, textDecoration: "none", display: "inline-block" }}
            >
              View &amp; verify
            </a>
            <ShareButton token={membershipCert.verify_token} />
            <span style={{ ...muted, fontSize: 13 }}>
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
    <div style={{ display: "grid", gap: 6, justifyItems: "start" }}>
      <button
        type="button"
        style={linkBtn}
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
        <p style={{ ...muted, fontSize: 13, margin: 0 }}>{message}</p>
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
  return (
    <button type="button" style={linkBtn} onClick={() => void onShare()}>
      {done ? "Link copied ✓" : "Share"}
    </button>
  );
}

function Tile({
  title,
  soon,
  children,
}: {
  title: string;
  soon?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div style={{ ...card, width: "auto", opacity: soon ? 0.62 : 1 }}>
      <div style={cardHead}>
        <span style={eyebrow}>{title}</span>
        {soon && <span style={{ ...badge, color: "var(--mist)", borderColor: "rgba(207,224,245,0.3)" }}>Soon</span>}
      </div>
      {children}
    </div>
  );
}

const verifyUrlFor = (token: string): string =>
  typeof window === "undefined"
    ? `/verify?id=${token}`
    : `${window.location.origin}/verify?id=${token}`;

const wrap: CSSProperties = { display: "grid", gap: 18, width: "min(1040px, 100%)" };
const grid: CSSProperties = {
  display: "grid",
  gap: 14,
  gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
};
const cardHead: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 10,
};
const eyebrow: CSSProperties = {
  fontFamily: "var(--body)",
  fontSize: 12,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  color: "var(--mist)",
  opacity: 0.75,
};
const badge: CSSProperties = {
  padding: "3px 10px",
  borderRadius: 999,
  border: "1px solid var(--gold, #D4A24C)",
  color: "var(--gold, #D4A24C)",
  fontFamily: "var(--body)",
  fontSize: 11,
  letterSpacing: "0.06em",
  textTransform: "uppercase",
};
const tileBody: CSSProperties = {
  margin: 0,
  color: "var(--mist)",
  fontFamily: "var(--body)",
  fontSize: 14,
  lineHeight: 1.5,
};
