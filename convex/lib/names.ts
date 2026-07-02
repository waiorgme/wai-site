// Name handling for the Join form (PRD §6.2): validation + name-aware Title
// Case. Pure functions, unit-tested. The server applies these too, so the
// stored name never depends on client behaviour.

// Letters, spaces, hyphens, apostrophes only; Latin only; length-capped;
// must START and END with a letter (no trailing "Sara-" / "O'Brien'").
// A pasted sentence fails the word-count, word-length, character, or
// common-word rule: at most 3 words per name PART (first or last), every
// word 2+ characters, no doubled punctuation, and no everyday English filler
// words ("please join me" is not a name). Name particles (bin, al, de, van)
// stay allowed. A 3-word phrase built from rarer words can still slip
// through any structural rule; the certificate confirm step ("Your
// certificate will read ...") is the human backstop for those.
const NAME_PART_RE = /^[A-Za-z](?:[A-Za-z' -]*[A-Za-z])?$/;
export const NAME_PART_MAX = 40;
const NAME_PART_MAX_WORDS = 3;

// Everyday sentence words that are not names. Kept small and high-signal so
// no real name is rejected; legitimate particles live in LOWERCASE_PARTICLES.
const NOT_NAME_WORDS = new Set([
  "the", "and", "for", "with", "from", "your", "you", "please", "join",
  "add", "me", "am", "is", "are", "was", "want", "would", "like", "hello",
  "hi", "hey", "test", "asdf", "name", "here", "now", "yes", "no",
]);

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
  if (words.length > NAME_PART_MAX_WORDS || words.some((w) => w.length < 2)) {
    return false;
  }
  if (words.some((w) => NOT_NAME_WORDS.has(w.toLowerCase()))) {
    return false;
  }
  // Three plain words in ONE name part ("aviation opens doors") is sentence
  // territory: allowed only when a known name particle anchors it
  // ("de la Cruz", "abd al Rahman"). Two-word parts stay free-form
  // ("Mary Jane", "bint Rashid").
  if (
    words.length === 3 &&
    !words.some((w) => LOWERCASE_PARTICLES.has(w.toLowerCase()))
  ) {
    return false;
  }
  return true;
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
