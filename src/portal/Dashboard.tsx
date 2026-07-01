import { useEffect, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { useAuthActions } from "@convex-dev/auth/react";
import { api } from "../../convex/_generated/api";
import { ProfileEditor } from "./ProfileEditor";
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
  const ensureCert = useMutation(api.certificates.ensureMyMembershipCertificate);
  const [editing, setEditing] = useState(false);

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

  if (editing) {
    return (
      <div style={panel}>
        <h1 style={h1}>Your profile</h1>
        <p style={muted}>
          The more you add, the better we can match you to opportunities, events
          and people. Nothing is required, so add what you like, anytime.
        </p>
        <ProfileEditor onClose={() => setEditing(false)} />
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
                ? "Thanks for confirming your email. A team member is reviewing your details; you will get an email when your membership is confirmed."
                : me?.lifecycle_state === "pending_guardian"
                  ? "Thanks for confirming your email. Because you are under 18, we need a parent or guardian to confirm too. We will guide you through that step by email."
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
