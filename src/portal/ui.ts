// Shared class names for the portal islands (panel-design slice).
//
// The portal + admin moved to the locked LIGHT system (vault Design Source
// Brief: paper base, navy headings, sky-core accent - "decided, not open").
// Styles live in src/styles/panel.css; these exports keep the old names so
// components read the same, but they are className strings now, used as
// className={...} (never style={...}). Genuinely functional inline styles
// (the join honeypot's display:none, the Soon-tile de-emphasis) stay inline
// in their components.

export const card = "pn-card pn-card--narrow";
export const panel = "pn-card pn-panel";
export const h1 = "pn-heading";
export const muted = "pn-muted";
export const label = "pn-label";
export const input = "pn-input";
export const textarea = "pn-input pn-textarea";
export const primaryBtn = "pn-btn";
export const linkBtn = "pn-link";
export const dl = "pn-dl";
export const checkboxRow = "pn-check";
export const errorText = "pn-error";
export const sectionTitle = "pn-sectitle";
export const hint = "pn-hint";
export const chip = "pn-chip";
export const chipActive = "pn-chip is-on";
