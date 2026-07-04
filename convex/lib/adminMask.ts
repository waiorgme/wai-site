// PII-minimisation for admin READ surfaces (spec criteria 2, 4, 8 and §8): the
// four queues are review lists, not member-data browsers, so a full name or a
// full email never leaves the server. This masks a display name to "First L."
// and is pure/unit-testable. Names with one part return just that part; empty
// input returns a neutral placeholder so a row never renders blank.
export const maskName = (raw: string): string => {
  const parts = raw.trim().split(/\s+/).filter((p) => p.length > 0);
  if (parts.length === 0) {
    return "(unnamed)";
  }
  if (parts.length === 1) {
    return parts[0];
  }
  const first = parts[0];
  const lastInitial = parts[parts.length - 1][0];
  return `${first} ${lastInitial.toUpperCase()}.`;
};
