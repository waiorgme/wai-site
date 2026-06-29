import { useEffect, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { QRCodeSVG } from "qrcode.react";

// The membership certificate, rendered to the confirmed design
// ([[02 Certificate Design & Eligibility Rules (Draft)]]). Fixed A4-landscape
// canvas (1122×794 @96dpi) so it matches the signed-off sample exactly; the
// ScaledCertificate wrapper fits it to any container width.

const NAVY = "#0A1D3F";
const SKY = "#018BE1";
const GOLD = "#D4A24C";
const SAND = "#F5EFE6";

export const CERT_W = 1122;
export const CERT_H = 794;

export type CertificateData = {
  recipientName: string;
  membershipNumber: number;
  publicId: string;
  dateLabel: string;
  isFounding: boolean;
  verifyUrl: string;
};

export function MembershipCertificate(data: CertificateData) {
  const year = data.dateLabel.split(" ").pop() ?? "";
  return (
    <div style={page}>
      <div style={frame}>
        <div style={frameInner} />
      </div>

      <div style={content}>
        <img
          src="/assets/cert/logo.png"
          alt="Women in Aviation Middle East"
          style={{ height: 78, objectFit: "contain", marginTop: 4 }}
        />

        <div style={title}>Certificate of Membership</div>
        <div style={titleAr}>شهادة عضوية</div>
        {data.isFounding && (
          <div style={foundingTag}>Founding Member · {year}</div>
        )}
        <div style={goldRule} />

        <div style={presented}>We are honoured to present this certificate to</div>
        <div style={name}>{data.recipientName}</div>
        <div style={nameUnderline} />

        <div style={body}>
          for becoming a member of <b style={{ fontWeight: 600 }}>Women in
          Aviation Middle East</b>. Membership Number{" "}
          <b style={{ fontWeight: 600 }}>WAIME-{data.membershipNumber}</b>.
        </div>
        <div style={dateLabel}>{data.dateLabel}</div>
      </div>

      <div style={footer}>
        <div style={sigCol}>
          <img
            src="/assets/cert/mervat-signature.png"
            alt=""
            style={{ height: 56, objectFit: "contain" }}
          />
          <div style={sigLine} />
          <div style={who}>
            Ms. Mervat Sultan
            <br />
            President, Women in Aviation Middle East
          </div>
        </div>

        <div style={verifyCol}>
          <div style={{ background: "#fff", padding: 4, borderRadius: 4 }}>
            <QRCodeSVG value={data.verifyUrl} size={66} fgColor={NAVY} bgColor="#fff" />
          </div>
          <div style={verifyId}>{data.publicId}</div>
          <div style={verifyUrl}>verify.waiorg.me</div>
        </div>

        <div style={sealCol}>
          <img
            src="/assets/cert/seal.png"
            alt="Official seal"
            style={{ height: 96, objectFit: "contain" }}
          />
        </div>
      </div>

      <div style={attribution}>
        Women in Aviation Middle East (WAI-ME) is a duly recognised chapter of
        Women in Aviation International. The Emirates Aerosports Federation acts
        as the host organisation and provides the registered address for WAI-ME.
      </div>
    </div>
  );
}

// Fits a fixed-size certificate to the available width, preserving aspect.
export function ScaledCertificate({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const el = ref.current;
    if (el === null) {
      return;
    }
    const update = () => setScale(Math.min(1, el.clientWidth / CERT_W));
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div ref={ref} style={{ width: "100%", height: CERT_H * scale, overflow: "hidden" }}>
      <div
        style={{
          width: CERT_W,
          height: CERT_H,
          transform: `scale(${scale})`,
          transformOrigin: "top left",
        }}
      >
        {children}
      </div>
    </div>
  );
}

const fontBody = "'Inter', system-ui, sans-serif";
const fontDisplay = "'Sora', 'Inter', sans-serif";
const fontAr = "'IBM Plex Sans Arabic', sans-serif";
const fontMono = "'JetBrains Mono', monospace";

const page: CSSProperties = {
  width: CERT_W,
  height: CERT_H,
  background: SAND,
  position: "relative",
  overflow: "hidden",
  fontFamily: fontBody,
};
const frame: CSSProperties = { position: "absolute", inset: 28, border: `2px solid ${NAVY}` };
const frameInner: CSSProperties = { position: "absolute", inset: 8, border: `1px solid ${GOLD}` };
const content: CSSProperties = {
  position: "absolute",
  inset: 70,
  bottom: 200,
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  textAlign: "center",
};
const title: CSSProperties = {
  fontFamily: fontDisplay,
  fontWeight: 800,
  color: NAVY,
  fontSize: 42,
  letterSpacing: "0.04em",
  textTransform: "uppercase",
  margin: "30px 0 2px",
};
const titleAr: CSSProperties = { fontFamily: fontAr, color: NAVY, fontSize: 18, opacity: 0.8, direction: "rtl" };
const foundingTag: CSSProperties = {
  marginTop: 10,
  padding: "4px 14px",
  border: `1px solid ${GOLD}`,
  borderRadius: 999,
  color: GOLD,
  fontFamily: fontDisplay,
  fontWeight: 700,
  fontSize: 12,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
};
const goldRule: CSSProperties = { width: 120, height: 3, background: GOLD, margin: "18px 0 22px", borderRadius: 2 };
const presented: CSSProperties = { fontFamily: fontBody, color: NAVY, fontSize: 15, letterSpacing: "0.04em" };
const name: CSSProperties = { fontFamily: fontDisplay, fontWeight: 700, color: NAVY, fontSize: 46, margin: "12px 0 6px" };
const nameUnderline: CSSProperties = { width: 430, height: 1, background: "rgba(10,29,63,0.25)", marginBottom: 20 };
const body: CSSProperties = { fontFamily: fontBody, color: NAVY, fontSize: 17, lineHeight: 1.6, maxWidth: 660 };
const dateLabel: CSSProperties = { fontFamily: fontMono, color: NAVY, fontSize: 14, marginTop: 16, opacity: 0.85 };

const footer: CSSProperties = {
  position: "absolute",
  left: 70,
  right: 70,
  bottom: 64,
  display: "flex",
  justifyContent: "space-between",
  alignItems: "flex-end",
};
const sigCol: CSSProperties = { textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center" };
const sigLine: CSSProperties = { width: 220, height: 1, background: NAVY, margin: "2px 0 7px" };
const who: CSSProperties = { fontFamily: fontBody, color: NAVY, fontSize: 12.5, lineHeight: 1.4 };
const verifyCol: CSSProperties = { textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", gap: 6 };
const verifyId: CSSProperties = { fontFamily: fontMono, fontSize: 11, color: NAVY };
const verifyUrl: CSSProperties = { fontFamily: fontBody, fontSize: 10.5, color: SKY };
const sealCol: CSSProperties = { textAlign: "center" };
const attribution: CSSProperties = {
  position: "absolute",
  left: 70,
  right: 70,
  bottom: 34,
  textAlign: "center",
  fontFamily: fontBody,
  fontSize: 9.5,
  color: "rgba(10,29,63,0.6)",
  lineHeight: 1.4,
};
