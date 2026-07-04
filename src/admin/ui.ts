import type { CSSProperties } from "react";

// Utilitarian admin layout styles (spec criterion 9): the same brand token set
// as the portal, but plain tables/lists/buttons, no marketing flourish and no
// gold accents (gold is recognition-only; nothing here is a recognition
// moment). Reuses src/portal/ui.ts primitives for cards, text and buttons; this
// file only adds the queue-list layout bits the portal did not need.

export const queueSection: CSSProperties = {
  display: "grid",
  gap: 12,
  padding: "20px 22px",
  background: "var(--ink-2)",
  border: "1px solid rgba(207, 224, 245, 0.14)",
  borderRadius: "var(--r-card)",
  width: "100%",
};

export const queueTitle: CSSProperties = {
  margin: 0,
  fontFamily: "var(--display)",
  fontWeight: 700,
  fontSize: 18,
  color: "var(--white)",
};

export const rowCard: CSSProperties = {
  display: "grid",
  gap: 10,
  padding: "14px 16px",
  borderRadius: "var(--r-card)",
  border: "1px solid rgba(207, 224, 245, 0.12)",
  background: "var(--ink)",
};

export const rowMeta: CSSProperties = {
  margin: 0,
  color: "var(--mist)",
  fontFamily: "var(--body)",
  fontSize: 13.5,
  lineHeight: 1.5,
};

export const rowName: CSSProperties = {
  margin: 0,
  color: "var(--white)",
  fontFamily: "var(--body)",
  fontWeight: 600,
  fontSize: 15,
};

export const tag: CSSProperties = {
  display: "inline-block",
  padding: "2px 9px",
  borderRadius: "var(--r-chip)",
  border: "1px solid rgba(207, 224, 245, 0.28)",
  color: "var(--mist)",
  fontFamily: "var(--body)",
  fontSize: 12,
  letterSpacing: "0.02em",
};
