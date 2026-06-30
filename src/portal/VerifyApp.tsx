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

function Verify() {
  const [token, setToken] = useState<string | null>(null);
  useEffect(() => {
    setToken(new URLSearchParams(window.location.search).get("id"));
  }, []);

  const cert = useQuery(
    api.certificates.getCertificateByToken,
    token ? { token } : "skip",
  );

  if (token === null || token === "") {
    return (
      <div style={card}>
        <h1 style={h1}>Verify a certificate</h1>
        <p style={muted}>
          This page confirms a WAI-ME certificate is genuine. Open it from the
          link or QR code on a certificate.
        </p>
      </div>
    );
  }
  if (cert === undefined) {
    return (
      <div style={card}>
        <p style={muted}>Checking certificate…</p>
      </div>
    );
  }
  if (cert === null) {
    return (
      <div style={card}>
        <h1 style={h1}>Certificate not found</h1>
        <p style={muted}>
          We couldn't find a certificate for this link. Please check it and try
          again.
        </p>
      </div>
    );
  }

  // Tell the truth about status (vault: valid / superseded / revoked / not found).
  if (cert.status !== "valid") {
    const headline =
      cert.status === "revoked"
        ? "This certificate has been revoked"
        : "This certificate has been superseded";
    return (
      <div style={{ ...card, width: "min(1040px, 100%)", textAlign: "center" }}>
        <p style={{ ...muted, color: "#ff9b9b", margin: 0, fontWeight: 600 }}>
          {cert.status === "revoked" ? "Revoked" : "Superseded"}
        </p>
        <h1 style={h1}>{headline}</h1>
        <p style={muted}>
          This was issued to {cert.recipient_name} (Membership Number WAIME-
          {cert.membership_number}). It is no longer the current record.
        </p>
      </div>
    );
  }

  const verifyUrl = `${window.location.origin}/verify?id=${token}`;
  return (
    <div style={{ display: "grid", gap: 18, width: "min(1040px, 100%)" }}>
      <div style={{ ...card, width: "100%", textAlign: "center" }}>
        <p style={{ ...muted, color: "var(--sky)", margin: 0, fontWeight: 600 }}>
          Verified genuine
        </p>
        <h1 style={h1}>
          {cert.recipient_name} is a member of Women in Aviation Middle East
        </h1>
        <p style={muted}>
          Membership Number WAIME-{cert.membership_number}. Issued{" "}
          {cert.issued_date_label}
          {cert.is_founding ? ". Founding Member" : ""}.
        </p>
        <button type="button" style={primaryBtn} onClick={() => window.print()}>
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
