// Member-facing URL validation at the server boundary (Gate 4 round 13). A
// bare startsWith("https://") check let a link carry CRLF / control
// characters that poison a downloaded .ics file (URL:...\r\nATTENDEE:...).
// This parses the URL, requires the https scheme and a hostname, and rejects
// ANY control character or whitespace anywhere in the string. Pure and
// unit-tested; used by every stored member-facing link (event meeting /
// recording / materials, partner website).

// Any C0 control char (<= 0x1F), space (0x20), or DEL (0x7F): the
// CRLF-injection vector, and nothing a legitimate link needs. A char-code
// scan, not a regex, to stay unambiguous.
const hasControlOrSpace = (s: string): boolean => {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c <= 0x20 || c === 0x7f) {
      return true;
    }
  }
  return false;
};

export const isSafeHttpsUrl = (raw: string, maxLength = 500): boolean => {
  if (raw.length === 0 || raw.length > maxLength) {
    return false;
  }
  if (hasControlOrSpace(raw)) {
    return false;
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  return url.protocol === "https:" && url.hostname.length > 0;
};
