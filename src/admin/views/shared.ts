// Shared vocabulary for the admin console v2 views (panel-experience slice):
// the view-state contract, GST time helpers, and the plain-word maps the copy
// rules require (standing words always carry a one-line plain explanation on
// the surfaces that show them; these maps keep the words consistent).

import type { MemberListRow } from "../../../convex/admin/members";
import type { AdminEventRow } from "../../../convex/admin/events";
import type { AdminOpportunityRow } from "../../../convex/admin/opportunities";
import type { PartnerListRow } from "../../../convex/admin/partners";

/* ---------- view state ---------- */

export type AdminViewName =
  | "overview"
  | "members"
  | "member"
  | "certificates"
  | "events"
  | "eventEditor"
  | "eventRegs"
  | "opportunities"
  | "opportunityEditor"
  | "partners"
  | "partnerEditor"
  | "reports"
  | "conflicts"
  | "pipeline"
  | "guardians"
  | "dataRequests"
  | "audit";

export type Go = (v: AdminViewName, id?: string) => void;

/* ---------- plain words for audit actions ---------- */

// The audit trail is Mervat's safety net; raw mutation names ("upsertEvent")
// are developer identifiers she cannot read. Every server action name maps
// to a plain sentence fragment; unknown names fall back to the raw string so
// nothing is ever hidden (design sweep blocker, 2026-07-07).
const PLAIN_ACTION_WORDS: Record<string, string> = {
  addMemberNote: "Added a note to a member",
  applyToOpportunity: "Member applied to an opportunity",
  "applyToOpportunity.refused": "An application was refused by the rules",
  approveDataRequest: "Approved a data request",
  archiveConflictRow: "Archived a claim-conflict record",
  autoCloseOpportunity: "Opportunity closed automatically at its deadline",
  cancelEvent: "Cancelled an event",
  cancelMyRsvp: "Member cancelled her RSVP",
  captureGuardianConsent: "Guardian consent recorded",
  "captureGuardianConsent.confirmed": "Guardian confirmed consent",
  "captureGuardianConsent.expired": "A guardian link expired",
  changeMemberStatus: "Changed a member's status",
  checkIn: "Marked event attendance",
  closeOpportunity: "Closed an opportunity",
  confirmGuardianConsent: "Guardian confirmed consent",
  confirmMagicLink: "Member confirmed her email",
  decideOpportunity: "Decided an opportunity",
  decidePipelineReview: "Decided a pipeline review",
  finalizeAttendance: "Closed an event's attendance",
  importBatch: "Imported member records",
  issueMembershipCertificate: "Issued a membership certificate",
  matchClaim: "Member claimed her record",
  "matchClaim.conflict": "A claim needs a human decision",
  "matchClaim.suppressedMinor": "A claim was held: under-18 record",
  postponeEvent: "Postponed an event",
  promoteFromWaitlist: "Moved a member off the waitlist",
  publishEvent: "Published an event",
  publishOpportunity: "Published an opportunity",
  raiseCounterFloor: "Raised the membership-number floor",
  recordResult: "Recorded an application result",
  reissueCertificate: "Re-issued a certificate",
  "resendGuardianEmail.refused": "A guardian email resend was refused",
  resendGuardianEmailFromPanel: "Resent a guardian email",
  resolveConflictAsClaimed: "Resolved a claim conflict",
  revealMemberContact: "Viewed a member's contact details",
  reveal_contact_email: "Viewed a member's contact details",
  revokeCertificate: "Revoked a certificate",
  rsvp: "Member booked a seat",
  sendGuardianEmail: "Sent a guardian consent email",
  "sendGuardianEmail.failed": "A guardian email failed to send",
  "sendGuardianEmail.refused": "A guardian email was refused",
  setDeliverableStatus: "Updated a partner deliverable",
  setDirectoryVisible: "Member changed her directory listing",
  "setDirectoryVisible.refused": "A directory change was refused by the rules",
  setEventLinks: "Added event recording or materials links",
  setPartnerLogo: "Set a partner's logo",
  setPipelineOptIn: "Member changed her pipeline choice",
  "setPipelineOptIn.refused": "A pipeline choice was refused by the rules",
  setSeal: "Changed a partner's seal",
  setShortlisted: "Changed an application shortlist",
  "standing.promote_active": "Member became an Active Member",
  submitDataRequest: "Member asked to see or delete her data",
  submitJoin: "New member joined",
  updateProfile: "Member updated her profile",
  upsertEvent: "Saved an event",
  upsertOpportunity: "Saved an opportunity",
  upsertPartner: "Saved a partner",
  withdrawMyApplication: "Member withdrew an application",
  writeConsent: "Member changed a consent",
  "writeConsent.refused": "A consent change was refused by the rules",
};

export const plainAction = (action: string): string =>
  PLAIN_ACTION_WORDS[action] ?? action;

/* ---------- GST time helpers ---------- */

// GST is UTC+4, fixed, no daylight saving - so the conversion is a constant
// offset and the labels can honestly say "GST" whatever the browser is set to.
const GST_OFFSET_MS = 4 * 60 * 60 * 1000;

const MONTHS_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
] as const;

const WEEKDAYS = [
  "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday",
] as const;

const MONTHS_LONG = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
] as const;

// Read a timestamp as GST via the UTC getters of this shifted Date.
export const gstDate = (ms: number): Date => new Date(ms + GST_OFFSET_MS);

const two = (n: number): string => String(n).padStart(2, "0");

export const fmtGstDate = (ms: number): string => {
  const d = gstDate(ms);
  return `${d.getUTCDate()} ${MONTHS_SHORT[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
};

export const fmtGstDateTime = (ms: number): string => {
  const d = gstDate(ms);
  return `${fmtGstDate(ms)} · ${two(d.getUTCHours())}:${two(d.getUTCMinutes())} GST`;
};

// Deadlines follow the board's "11:59 PM GST" label convention: 12-hour clock.
export const fmtGstDeadline = (ms: number): string => {
  const d = gstDate(ms);
  const h24 = d.getUTCHours();
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  const ampm = h24 < 12 ? "AM" : "PM";
  return `${fmtGstDate(ms)} · ${h12}:${two(d.getUTCMinutes())} ${ampm} GST`;
};

export const gstMonthShort = (ms: number): string =>
  MONTHS_SHORT[gstDate(ms).getUTCMonth()];

export const gstDayOfMonth = (ms: number): number => gstDate(ms).getUTCDate();

export const gstYear = (ms: number): number => gstDate(ms).getUTCFullYear();

// datetime-local value ("YYYY-MM-DDTHH:mm") treated as GST wall-clock time.
export const msFromGstInput = (value: string): number | null => {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value);
  if (m === null) {
    return null;
  }
  return (
    Date.UTC(
      Number(m[1]),
      Number(m[2]) - 1,
      Number(m[3]),
      Number(m[4]),
      Number(m[5]),
    ) - GST_OFFSET_MS
  );
};

export const gstInputValue = (ms: number | null): string => {
  if (ms === null) {
    return "";
  }
  const d = gstDate(ms);
  return `${d.getUTCFullYear()}-${two(d.getUTCMonth() + 1)}-${two(d.getUTCDate())}T${two(d.getUTCHours())}:${two(d.getUTCMinutes())}`;
};

// The overview greeting works off the operator's local clock, not GST.
export const localDateEyebrow = (now: Date): string =>
  `${WEEKDAYS[now.getDay()]} · ${now.getDate()} ${MONTHS_LONG[now.getMonth()]} ${now.getFullYear()}`;

export const greetingForHour = (hour: number): string => {
  if (hour < 12) {
    return "Good morning.";
  }
  return hour < 17 ? "Good afternoon." : "Good evening.";
};

/* ---------- small formatting helpers ---------- */

export const initials = (name: string): string => {
  const parts = name.trim().split(/\s+/).filter((p) => p.length > 0);
  if (parts.length === 0) {
    return "?";
  }
  const first = parts[0][0] ?? "?";
  const last = parts.length > 1 ? (parts[parts.length - 1][0] ?? "") : "";
  return (first + last).toUpperCase();
};

export const orUndef = (s: string): string | undefined => {
  const t = s.trim();
  return t === "" ? undefined : t;
};

export const plural = (n: number, one: string, many: string): string =>
  `${n} ${n === 1 ? one : many}`;

/* ---------- plain-word maps ---------- */

export type Lifecycle = MemberListRow["lifecycle_state"];
export type Lane = MemberListRow["member_lane"];
export type Standing = MemberListRow["standing"];

export const LIFECYCLE_WORDS: Record<Lifecycle, string> = {
  email_unverified: "Waiting on email confirmation",
  consent_pending: "Waiting on consent",
  pending_guardian: "Waiting on a guardian",
  claim_pending: "Claim in progress",
  pending_review: "Waiting on a review",
  active: "Active",
  dormant: "Dormant",
  suspended: "Suspended",
  erasure_requested: "Erasure requested",
  erasure_in_progress: "Erasure in progress",
  archived: "Archived",
};

export const LIFECYCLE_EXPLAIN: Record<Lifecycle, string> = {
  email_unverified: "She has not confirmed her email yet; this clears on its own.",
  consent_pending: "She has not accepted the terms yet; this clears on its own.",
  pending_guardian: "A guardian still needs to confirm; the queue tracks it.",
  claim_pending: "She started claiming a legacy record and has not finished.",
  pending_review: "A review is open on this record; the queues handle it.",
  active: "Full member access.",
  dormant: "Paused - her record is kept but she is not counted as active.",
  suspended: "Access on hold after an upheld conduct report.",
  erasure_requested: "She asked for erasure; it runs through the data-requests queue.",
  erasure_in_progress: "Erasure is underway through the data-requests queue.",
  archived: "A closed record, kept for the trail.",
};

// Tag tone per lifecycle state (the round-1 pn-tag family).
export const lifecycleTagClass = (state: Lifecycle): string => {
  if (state === "active") {
    return "pn-tag pn-tag--ok";
  }
  if (state === "suspended") {
    return "pn-tag pn-tag--err";
  }
  if (
    state === "dormant" ||
    state === "archived" ||
    state === "erasure_requested" ||
    state === "erasure_in_progress"
  ) {
    return "pn-tag";
  }
  return "pn-tag pn-tag--info";
};

export const LANE_WORDS: Record<Lane, string> = {
  standard: "Standard",
  minor: "Under 18",
  ally: "Ally",
  restricted_unknown: "Restricted",
};

export const LANE_EXPLAIN: Record<Lane, string> = {
  standard: "A woman in aviation - the standard membership.",
  minor: "Under 18 - guardian consent applies and adult surfaces stay switched off.",
  ally: "A man who supports the mission - no directory listing and no women-only opportunities.",
  restricted_unknown: "Her details could not be confirmed, so sensitive surfaces stay switched off.",
};

export const STANDING_WORDS: Record<Standing, string> = {
  member: "Member",
  active_member: "Active Member",
  ambassador: "Ambassador",
  leadership_circle: "Leadership Circle",
};

export const STANDING_EXPLAIN: Record<Standing, string> = {
  member: "She has joined; completing her profile and taking part moves her up.",
  active_member: "Profile complete and at least one action taken - she can be listed in the directory and gets priority booking windows.",
  ambassador: "An invitation level; not open yet.",
  leadership_circle: "An invitation level; not open yet.",
};

/* ---------- events ---------- */

export type EventState = AdminEventRow["state"];
export type EventCategory = AdminEventRow["category"];

export const EVENT_CATEGORY_WORDS: Record<EventCategory, string> = {
  workshop: "Workshop",
  story_session: "Story session",
  briefing: "Briefing",
  skills_clinic: "Skills clinic",
  meetup: "Meetup",
  conference: "Conference",
};

export const EVENT_STATE_WORDS: Record<EventState, string> = {
  draft: "Draft",
  published: "Published",
  postponed: "Postponed",
  cancelled: "Cancelled",
  attendance_finalized: "Closed",
};

export const eventStateTagClass = (state: EventState): string => {
  if (state === "published") {
    return "pn-tag pn-tag--ok";
  }
  if (state === "cancelled") {
    return "pn-tag pn-tag--err";
  }
  if (state === "postponed") {
    return "pn-tag pn-tag--info";
  }
  return "pn-tag";
};

export type RegistrationState =
  | "registered"
  | "waitlisted"
  | "cancelled"
  | "attended"
  | "no_show";

export const REG_STATE_WORDS: Record<RegistrationState, string> = {
  registered: "Registered",
  waitlisted: "On the waiting list",
  cancelled: "Cancelled",
  attended: "Attended",
  no_show: "No show",
};

export const regStateTagClass = (state: RegistrationState): string => {
  if (state === "attended") {
    return "pn-tag pn-tag--ok";
  }
  if (state === "no_show" || state === "cancelled") {
    return "pn-tag";
  }
  return "pn-tag pn-tag--info";
};

/* ---------- opportunities ---------- */

export type OpportunityType = AdminOpportunityRow["type"];
export type OpportunityState = AdminOpportunityRow["state"];

export const OPP_TYPE_WORDS: Record<OpportunityType, string> = {
  competitive: "Competitive",
  single_winner: "One winner",
  evergreen: "Ongoing benefit",
};

export const OPP_TYPE_EXPLAIN: Record<OpportunityType, string> = {
  competitive: "Several members apply; one or more win.",
  single_winner: "Members apply; exactly one gets it.",
  evergreen: "No applications - members follow a claim path any time.",
};

export const OPP_STATE_WORDS: Record<OpportunityState, string> = {
  draft: "Draft",
  open: "Open",
  closed: "Closed",
  decided: "Decided",
};

export const oppStateTagClass = (state: OpportunityState): string => {
  if (state === "open") {
    return "pn-tag pn-tag--ok";
  }
  if (state === "decided") {
    return "pn-tag pn-tag--info";
  }
  return "pn-tag";
};

export type ApplicationState =
  | "received"
  | "shortlisted"
  | "won"
  | "lost"
  | "withdrawn";

export const APP_STATE_WORDS: Record<ApplicationState, string> = {
  received: "Received",
  shortlisted: "Shortlisted",
  won: "Won",
  lost: "Not selected",
  withdrawn: "Withdrew",
};

export const appStateTagClass = (state: ApplicationState): string => {
  if (state === "won") {
    return "pn-tag pn-tag--ok";
  }
  if (state === "shortlisted") {
    return "pn-tag pn-tag--info";
  }
  return "pn-tag";
};

/* ---------- partners ---------- */

export type PartnerTier = PartnerListRow["tier"];
export type PartnerStatus = PartnerListRow["status"];
export type PartnerSeal = PartnerListRow["seal"];
export type DeliverableStatus =
  | "committed"
  | "in_progress"
  | "delivered"
  | "part_delivered";

export const TIER_WORDS: Record<PartnerTier, string> = {
  supporter: "Supporter",
  partner: "Partner",
  champion: "Champion",
};

export const TIER_EXPLAIN: Record<PartnerTier, string> = {
  supporter: "Backs one activity or gift in the year.",
  partner: "Delivers a package of commitments across the year.",
  champion: "The deepest commitment - a named programme partner.",
};

export const PARTNER_STATUS_WORDS: Record<PartnerStatus, string> = {
  prospect: "In conversation",
  active: "Signed and active",
  lapsed: "Term ended",
  declined: "Said no",
};

export const partnerStatusTagClass = (status: PartnerStatus): string => {
  if (status === "active") {
    return "pn-tag pn-tag--ok";
  }
  if (status === "prospect") {
    return "pn-tag pn-tag--info";
  }
  return "pn-tag";
};

export const DELIVERABLE_WORDS: Record<DeliverableStatus, string> = {
  committed: "Committed",
  in_progress: "In progress",
  delivered: "Delivered",
  part_delivered: "Partly delivered",
};
