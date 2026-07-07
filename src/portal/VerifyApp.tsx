import { useEffect, useState } from "react";
import { ConvexProvider, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { convex } from "./convex";
import { MembershipCertificate, ScaledCertificate } from "../certificate/MembershipCertificate";
import { card, h1, muted, primaryBtn } from "./ui";

// Public certificate verification. The page IS the proof: anyone with the link
// confirms the certificate is real and sees what it states. No auth.
export function VerifyApp() {
  return (
    <ConvexProvider client={convex}>
      <Verify />
    </ConvexProvider>
  );
}

// Brand row above the non-certificate states (light logo asset on paper).
function Brand() {
  return (
    <div className="pn-brand">
      <img src="/assets/wai-me-logo.png" alt="Women in Aviation Middle East" />
    </div>
  );
}

function Verify() {
  const [token, setToken] = useState<string | null>(null);
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    setToken(new URLSearchParams(window.location.search).get("id"));
  }, []);

  const cert = useQuery(
    api.certificates.getCertificateByToken,
    token ? { token } : "skip",
  );

  // UX-1: this page is a trust surface, so it never spins forever. If the
  // lookup has no answer after 8 seconds, say so plainly and give a human
  // fallback.
  useEffect(() => {
    if (cert !== undefined || !token) {
      setSlow(false);
      return;
    }
    const timer = window.setTimeout(() => setSlow(true), 8000);
    return () => window.clearTimeout(timer);
  }, [cert, token]);

  if (token === null || token === "") {
    return (
      <>
        <Brand />
        <div className={card}>
          <h1 className={h1}>Verify a certificate</h1>
          <p className={muted}>
            This page confirms a WAI-ME certificate is genuine. Open it from the
            link or QR code on a certificate.
          </p>
        </div>
      </>
    );
  }
  if (cert === undefined) {
    return (
      <>
        <Brand />
        <div className={card}>
          {slow ? (
            <>
              <h1 className={h1}>We can't reach our records right now</h1>
              <p className={muted}>
                This is usually temporary. Please reload the page in a minute. If
                it keeps happening, email{" "}
                <a href="mailto:support@waiorg.me">
                  support@waiorg.me
                </a>{" "}
                with the certificate ID and we will confirm it for you.
              </p>
            </>
          ) : (
            <p className={muted}>Checking certificate…</p>
          )}
        </div>
      </>
    );
  }
  if (cert === null) {
    return (
      <>
        <Brand />
        <div className={card}>
          <h1 className={h1}>Certificate not found</h1>
          <p className={muted}>
            We couldn't find a certificate for this link. Please check it and try
            again.
          </p>
        </div>
      </>
    );
  }

  // Tell the truth about status (vault: valid / superseded / revoked / not found).
  if (cert.status !== "valid") {
    const headline =
      cert.status === "revoked"
        ? "This certificate has been revoked"
        : "This certificate has been superseded";
    return (
      <>
        <Brand />
        <div className="pn-card" style={{ inlineSize: "min(1040px, 100%)", textAlign: "center" }}>
          <p className="pn-eyebrow pn-eyebrow--err" style={{ justifySelf: "center" }}>
            {cert.status === "revoked" ? "Revoked" : "Superseded"}
          </p>
          <h1 className={h1}>{headline}</h1>
          <p className={muted}>
            This was issued to {cert.recipient_name} (Membership number WAIME-
            {cert.membership_number}). It is no longer the current record.
          </p>
        </div>
      </>
    );
  }

  const verifyUrl = `${window.location.origin}/verify?id=${token}`;
  return (
    <div style={{ display: "grid", gap: 18, width: "min(1040px, 100%)" }}>
      <div className="pn-card pn-queue" style={{ textAlign: "center" }}>
        <p className="pn-eyebrow on-paper" style={{ justifySelf: "center" }}>
          Verified genuine
        </p>
        <h1 className={h1}>
          {cert.recipient_name} is a member of Women in Aviation Middle East
        </h1>
        <p className={muted}>
          Membership number WAIME-{cert.membership_number}. Issued{" "}
          {cert.issued_date_label}
          {cert.is_founding ? ". Founding Member" : ""}.
        </p>
        <button type="button" className={primaryBtn} onClick={() => window.print()}>
          Print / Save as PDF
        </button>
      </div>

      <div className="cert-print" style={{ width: "100%" }}>
        <ScaledCertificate>
          <MembershipCertificate
            recipientName={cert.recipient_name}
            membershipNumber={cert.membership_number}
            certId={`WAIME-MEM-${cert.membership_number}`}
            dateLabel={cert.issued_date_label}
            isFounding={cert.is_founding}
            verifyUrl={verifyUrl}
          />
        </ScaledCertificate>
      </div>
    </div>
  );
}
