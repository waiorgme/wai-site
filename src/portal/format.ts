// Shared formatting + plain-words maps for the portal shell views
// (panel-experience slice). Event times are always shown in Gulf time with
// the event's own display label (GST): the community runs on Gulf time and
// the events carry that label from the admin side.

const GULF_TZ = "Asia/Dubai";

export const gulfDate = (ts: number): string =>
  new Intl.DateTimeFormat("en-GB", {
    timeZone: GULF_TZ,
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(ts));

export const gulfTime = (ts: number): string =>
  new Intl.DateTimeFormat("en-GB", {
    timeZone: GULF_TZ,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(ts));

// The DateBlock voice: short month + day number, in Gulf time.
export const gulfMonthDay = (ts: number): { month: string; day: string } => {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: GULF_TZ,
    month: "short",
    day: "numeric",
  }).formatToParts(new Date(ts));
  return {
    month: parts.find((p) => p.type === "month")?.value ?? "",
    day: parts.find((p) => p.type === "day")?.value ?? "",
  };
};

// Notification timestamps degrade with age (time today, weekday this week,
// date otherwise). Viewer-local on purpose: notifications are personal.
export const whenLabel = (ts: number): string => {
  const then = new Date(ts);
  const now = new Date();
  if (then.toDateString() === now.toDateString()) {
    return new Intl.DateTimeFormat("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(then);
  }
  if (now.getTime() - ts < 6 * 24 * 60 * 60 * 1000) {
    return new Intl.DateTimeFormat("en-GB", { weekday: "short" }).format(then);
  }
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
  }).format(then);
};

// "member_since" arrives as an ISO date (or a legacy label for migrated
// members); ISO dates get the human form, anything else is shown as recorded.
export const memberSinceLabel = (value: string): string => {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: "UTC",
      day: "numeric",
      month: "long",
      year: "numeric",
    }).format(new Date(`${value}T00:00:00Z`));
  }
  return value;
};

export type Standing =
  | "member"
  | "active_member"
  | "ambassador"
  | "leadership_circle";

// Standing plain words (member surfaces never show the raw keys).
export const standingWord = (standing: Standing): string =>
  ({
    member: "Member",
    active_member: "Active Member",
    ambassador: "Ambassador",
    leadership_circle: "Leadership Circle",
  })[standing];

// The one-line plain explanation that must travel with every standing word
// (vault mandate).
export const standingLine = (standing: Standing): string =>
  ({
    member: "Every member starts here - you're part of the community from day one.",
    active_member:
      "For members who take part: a complete profile plus one action, like attending an event or applying for an opportunity.",
    ambassador:
      "For members who lift the community. By invitation, later this year.",
    leadership_circle:
      "The community's leading voices. By invitation, later this year.",
  })[standing];

// Deadlines follow the spec's "11:59 PM GST" label convention: Gulf time,
// 12-hour clock, GST named.
export const gulfDeadlineLabel = (ts: number): string => {
  const time = new Intl.DateTimeFormat("en-US", {
    timeZone: GULF_TZ,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(ts));
  return `${gulfDate(ts)} · ${time} GST`;
};

export type OpportunityType = "competitive" | "single_winner" | "evergreen";

// Opportunity types in plain words (no internal jargon on member surfaces).
export const opportunityTypeWord = (type: OpportunityType): string =>
  ({
    competitive: "Scholarship - limited places",
    single_winner: "One placement",
    evergreen: "Ongoing member benefit",
  })[type];

export type ApplicationState =
  | "received"
  | "shortlisted"
  | "won"
  | "lost"
  | "withdrawn";

// Application states as short honest words (chips); the fuller one-line
// explanations live in the opportunities views.
export const applicationStateWord = (state: ApplicationState): string =>
  ({
    received: "Received",
    shortlisted: "Shortlisted",
    won: "Yours",
    lost: "Not this time",
    withdrawn: "Withdrawn",
  })[state];

export type EventCategory =
  | "workshop"
  | "story_session"
  | "briefing"
  | "skills_clinic"
  | "meetup"
  | "conference";

export const eventCategoryWord = (category: EventCategory): string =>
  ({
    workshop: "Workshop",
    story_session: "Story session",
    briefing: "Briefing",
    skills_clinic: "Skills clinic",
    meetup: "Meetup",
    conference: "Conference",
  })[category];

export const initialsOf = (name: string): string => {
  const parts = name.split(/\s+/).filter((part) => part.length > 0);
  const letters = parts
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");
  return letters === "" ? "M" : letters;
};

export const excerpt = (text: string, max: number): string =>
  text.length <= max ? text : `${text.slice(0, max).trimEnd()}…`;

// Client-built .ics download (a Blob, no dependency): one VEVENT in UTC.
export const downloadIcs = (event: {
  id: string;
  title: string;
  description?: string;
  location?: string;
  startsAt: number;
  endsAt: number;
}): void => {
  const stamp = (ts: number): string =>
    new Date(ts).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const esc = (value: string): string =>
    value
      .replace(/\\/g, "\\\\")
      .replace(/;/g, "\\;")
      .replace(/,/g, "\\,")
      .replace(/\r?\n/g, "\\n");
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//WAI-ME//Member portal//EN",
    "BEGIN:VEVENT",
    `UID:${event.id}@waiorg.me`,
    `DTSTAMP:${stamp(Date.now())}`,
    `DTSTART:${stamp(event.startsAt)}`,
    `DTEND:${stamp(event.endsAt)}`,
    `SUMMARY:${esc(event.title)}`,
    event.location ? `LOCATION:${esc(event.location)}` : null,
    event.description ? `DESCRIPTION:${esc(event.description)}` : null,
    "END:VEVENT",
    "END:VCALENDAR",
  ].filter((line): line is string => line !== null);
  const blob = new Blob([lines.join("\r\n")], { type: "text/calendar" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "wai-me-event.ics";
  anchor.click();
  URL.revokeObjectURL(url);
};
