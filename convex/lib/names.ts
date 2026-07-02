// Name handling for the Join form (PRD §6.2): validation + name-aware Title
// Case. Pure functions, unit-tested. The server applies these too, so the
// stored name never depends on client behaviour.

// Letters, spaces, hyphens, apostrophes only; Latin only; length-capped.
// A pasted sentence fails the word-count, word-length, or character rule:
// at most 3 words per name PART (first or last), every word 2+ characters
// (kills "I am here"-style fragments and stray initials), no doubled
// punctuation.
const NAME_PART_RE = /^[A-Za-z][A-Za-z' -]*$/;
export const NAME_PART_MAX = 40;
const NAME_PART_MAX_WORDS = 3;

export const isValidNamePart = (raw: string): boolean => {
  const s = raw.trim();
  if (s.length < 2 || s.length > NAME_PART_MAX) {
    return false;
  }
  if (!NAME_PART_RE.test(s)) {
    return false;
  }
  if (/[-']{2}/.test(s)) {
    return false;
  }
  const words = s.split(/\s+/);
  return words.length <= NAME_PART_MAX_WORDS && words.every((w) => w.length >= 2);
};

// Particles that stay lowercase in Arab and European name conventions.
const LOWERCASE_PARTICLES = new Set([
  "bint", "bin", "ibn", "al", "el", "abu", "abd",
  "de", "da", "di", "del", "della", "van", "von", "der", "den", "la", "le",
]);

const capWord = (w: string): string => {
  if (w.length === 0) {
    return w;
  }
  // Mc prefix: mckenzie -> McKenzie.
  if (/^mc/i.test(w) && w.length > 2) {
    return "Mc" + w[2].toUpperCase() + w.slice(3).toLowerCase();
  }
  return w[0].toUpperCase() + w.slice(1).toLowerCase();
};

// One space/hyphen-free token, possibly with apostrophes: o'brien -> O'Brien.
const caseToken = (token: string): string =>
  token
    .split("'")
    .map((part, i) => (i === 0 ? capWord(part) : capWord(part)))
    .join("'");

// One whitespace-separated word, possibly hyphenated: al-sayegh -> Al-Sayegh,
// sherbaji-khan -> Sherbaji-Khan. NOTE: hyphenated segments are always
// capitalised (Al-Sayegh), matching the PRD examples; the particle rule
// applies to standalone words only (bint rashid -> bint Rashid).
const caseWord = (word: string): string => {
  if (word.includes("-")) {
    return word.split("-").map(caseToken).join("-");
  }
  if (LOWERCASE_PARTICLES.has(word.toLowerCase())) {
    return word.toLowerCase();
  }
  return caseToken(word);
};

export const nameCase = (raw: string): string =>
  raw
    .trim()
    .replace(/\s+/g, " ")
    .split(" ")
    .map(caseWord)
    .join(" ");

// The full display name as it will appear on the certificate.
export const fullName = (first: string, last: string): string =>
  `${nameCase(first)} ${nameCase(last)}`.trim();
