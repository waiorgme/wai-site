import type { CSSProperties } from "react";

// Shared brand-token styles for the portal islands (sign-in + join).

export const card: CSSProperties = {
  width: "min(480px, 100%)",
  background: "var(--ink-2)",
  border: "1px solid rgba(207, 224, 245, 0.14)",
  borderRadius: "var(--r-card)",
  padding: "32px 28px",
  display: "grid",
  gap: 14,
  boxShadow: "0 24px 60px rgba(0,0,0,0.4)",
};

export const h1: CSSProperties = {
  margin: 0,
  fontFamily: "var(--display)",
  fontWeight: 700,
  fontSize: 26,
  color: "var(--white)",
};

export const muted: CSSProperties = {
  margin: 0,
  color: "var(--mist)",
  lineHeight: 1.5,
  fontFamily: "var(--body)",
};

export const label: CSSProperties = {
  display: "grid",
  gap: 6,
  color: "var(--mist)",
  fontFamily: "var(--body)",
  fontSize: 14,
};

export const input: CSSProperties = {
  width: "100%",
  padding: "11px 13px",
  borderRadius: 12,
  border: "1px solid rgba(207, 224, 245, 0.22)",
  background: "var(--ink)",
  color: "var(--white)",
  fontSize: 16,
  fontFamily: "var(--body)",
  boxSizing: "border-box",
};

export const primaryBtn: CSSProperties = {
  padding: "12px 16px",
  borderRadius: "var(--r-chip)",
  border: "none",
  background: "var(--sky)",
  color: "var(--ink)",
  fontWeight: 700,
  fontSize: 15,
  fontFamily: "var(--body)",
  cursor: "pointer",
};

export const linkBtn: CSSProperties = {
  justifySelf: "start",
  marginTop: 4,
  padding: 0,
  border: "none",
  background: "none",
  color: "var(--sky)",
  fontFamily: "var(--body)",
  fontSize: 14,
  cursor: "pointer",
  textDecoration: "underline",
};

export const dl: CSSProperties = {
  margin: 0,
  display: "grid",
  gap: 10,
  padding: "12px 0",
  borderTop: "1px solid rgba(207, 224, 245, 0.12)",
  borderBottom: "1px solid rgba(207, 224, 245, 0.12)",
};

export const checkboxRow: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "auto 1fr",
  gap: 10,
  alignItems: "start",
  color: "var(--mist)",
  fontFamily: "var(--body)",
  fontSize: 13.5,
  lineHeight: 1.45,
};

export const errorText: CSSProperties = {
  margin: 0,
  color: "#ff9b9b",
  fontFamily: "var(--body)",
  fontSize: 14,
};

// Wider card for the profile editor (the sign-in card is 480px).
export const panel: CSSProperties = {
  ...card,
  width: "min(680px, 100%)",
};

export const textarea: CSSProperties = {
  ...input,
  minHeight: 88,
  resize: "vertical",
  lineHeight: 1.5,
};

export const sectionTitle: CSSProperties = {
  margin: "8px 0 0",
  fontFamily: "var(--display)",
  fontWeight: 700,
  fontSize: 15,
  letterSpacing: "0.02em",
  color: "var(--white)",
};

export const hint: CSSProperties = {
  margin: 0,
  color: "var(--mist)",
  opacity: 0.72,
  fontFamily: "var(--body)",
  fontSize: 12.5,
  lineHeight: 1.4,
};

export const chip: CSSProperties = {
  padding: "7px 12px",
  borderRadius: "var(--r-chip)",
  border: "1px solid rgba(207, 224, 245, 0.22)",
  background: "transparent",
  color: "var(--mist)",
  fontFamily: "var(--body)",
  fontSize: 13,
  cursor: "pointer",
};

export const chipActive: CSSProperties = {
  ...chip,
  border: "1px solid var(--sky)",
  background: "rgba(110, 168, 254, 0.16)",
  color: "var(--white)",
};
