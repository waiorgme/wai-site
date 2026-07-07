import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import {
  MembershipCertificate,
  ScaledCertificate,
} from "../../certificate/MembershipCertificate";
import { linkBtn, muted, primaryBtn } from "../ui";

// The certificate card, moved unchanged out of round 1's Dashboard.tsx so the
// shell views (adult Home, youth Home) can render the exact same composition.

export type MemberView = ReturnType<
  typeof useQuery<typeof api.members.getCurrentMember>
>;
export type CertsView = ReturnType<
  typeof useQuery<typeof api.certificates.getMyCertificates>
>;
export type MembershipCertView = NonNullable<CertsView>[number] | null;

// The certificate card, shared by the adult and youth dashboards.
export function CertificateSection({
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
              Membership number WAIME-{membershipCert.membership_number}
            </span>
          </div>
        </>
      )}
    </section>
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
      <span role="status">{done ? "Link copied" : "Share"}</span>
    </button>
  );
}

const verifyUrlFor = (token: string): string =>
  typeof window === "undefined"
    ? `/verify?id=${token}`
    : `${window.location.origin}/verify?id=${token}`;
