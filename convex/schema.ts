import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { authTables } from "@convex-dev/auth/server";

// Schema for the signup + login slice. Tables and indexes follow the locked
// Stage 0 technical design (§4, §10). Later slices add events, opportunities,
// certificates, the recognition ledger, and the privacy/ops entities.

const lifecycleState = v.union(
  v.literal("email_unverified"),
  v.literal("consent_pending"),
  v.literal("pending_guardian"),
  v.literal("claim_pending"),
  v.literal("pending_review"),
  v.literal("active"),
  v.literal("dormant"),
  v.literal("suspended"),
  v.literal("erasure_requested"),
  v.literal("erasure_in_progress"),
  v.literal("archived"),
);

const memberLane = v.union(
  v.literal("standard"),
  v.literal("minor"),
  v.literal("ally"),
  v.literal("restricted_unknown"),
);

export default defineSchema({
  ...authTables,

  // §4.1 Member: identity + lifecycle + age block (replaces flat status / minor_flag).
  members: defineTable({
    userId: v.optional(v.id("users")),
    email: v.string(),
    name: v.string(),
    mobile: v.optional(v.string()),
    source: v.union(v.literal("new_signup"), v.literal("migrated")),
    lifecycle_state: lifecycleState,
    date_of_birth: v.optional(v.string()),
    date_of_birth_source: v.union(
      v.literal("self_declared"),
      v.literal("migrated"),
      v.literal("guardian_confirmed"),
      v.literal("unknown"),
    ),
    age_confidence: v.union(
      v.literal("confirmed"),
      v.literal("declared"),
      v.literal("unknown"),
    ),
    minor_until: v.optional(v.string()),
    age_up_prompted_at: v.optional(v.number()),
    guardian_consent_state: v.union(
      v.literal("not_required"),
      v.literal("pending"),
      v.literal("confirmed"),
    ),
    gender: v.union(v.literal("female"), v.literal("male")),
    career_stage_answer: v.optional(v.string()),
    member_lane: memberLane,
    created_at: v.number(),
    // For migrated members: when she FIRST joined WAI-ME (from the legacy
    // list), so "member since" stays truthful across the migration.
    original_joined_at: v.optional(v.string()),

    // §4.1 profile fields (talent-pipeline spec). All optional, filled after
    // join through completeness nudges; option values validated at the
    // updateProfile boundary against convex/lib/profile.ts.
    headline: v.optional(v.string()),
    bio: v.optional(v.string()),
    photo_storage_id: v.optional(v.id("_storage")),
    nationality: v.optional(v.string()),
    country_of_residence: v.optional(v.string()),
    function_area: v.optional(v.string()),
    role: v.optional(v.string()),
    second_function_area: v.optional(v.string()),
    second_role: v.optional(v.string()),
    years_in_aviation: v.optional(v.string()),
    current_job_title: v.optional(v.string()),
    current_employer: v.optional(v.string()),
    sectors: v.optional(v.array(v.string())),
    certifications: v.optional(v.array(v.string())),
    certifications_other: v.optional(v.string()),
    highest_qualification: v.optional(v.string()),
    field_of_study: v.optional(v.string()),
    institution: v.optional(v.string()),
    looking_for: v.optional(v.array(v.string())),
    profile_complete: v.optional(v.boolean()),

    // Group H, the two opt-in toggles (field spec): both default OFF (absent),
    // locked off for under-18 and unknown-age lanes, enforced server-side.
    directory_visible: v.optional(v.boolean()),
    pipeline_state: v.optional(
      v.union(
        v.literal("off"),
        v.literal("review_pending"),
        v.literal("on"),
        v.literal("rejected"),
      ),
    ),

    // Standing, Ladder 2 (Recognition Thresholds decision). Absent = member.
    // Rung 2 (active_member) is the automatic binary gate shipped in the
    // panel-experience slice: profile complete + at least one qualifying
    // action. Ambassador / Leadership Circle values exist for display but are
    // only reachable by the later recognition-engine slice (nomination batch);
    // nothing in this slice may write them.
    standing: v.optional(
      v.union(
        v.literal("member"),
        v.literal("active_member"),
        v.literal("ambassador"),
        v.literal("leadership_circle"),
      ),
    ),
  })
    .index("by_email", ["email"])
    .index("by_userId", ["userId"])
    .index("by_lifecycle_state", ["lifecycle_state"])
    .index("by_member_lane", ["member_lane"])
    .index("by_minor_until", ["minor_until"]),

  // §4.2 ImportedMember: the 1,309 legacy rows land here first so claim is safe.
  importedMembers: defineTable({
    legacy_row_id: v.string(),
    legacy_row_hash: v.string(),
    normalized_email: v.string(),
    name: v.string(),
    mobile: v.optional(v.string()),
    dob_if_known: v.optional(v.string()),
    legacy_position: v.optional(v.string()),
    legacy_company: v.optional(v.string()),
    legacy_bio: v.optional(v.string()),
    // Carried from the cleaned list (claim-wave slice): the member's legacy
    // WAIME-### number (kept on her certificate, DATA-1), recorded gender,
    // countries, and her original join date.
    gender: v.optional(v.union(v.literal("female"), v.literal("male"))),
    nationality: v.optional(v.string()),
    country_of_residence: v.optional(v.string()),
    legacy_membership_number: v.optional(v.number()),
    legacy_created_at: v.optional(v.string()),
    claim_state: v.union(
      v.literal("unclaimed"),
      v.literal("claim_in_progress"),
      v.literal("claimed"),
      v.literal("conflict"),
      v.literal("suppressed_minor"),
      // The non-matching row of a resolved duplicate-email pair: permanently
      // parked (correct + archive decision, 2026-07-04), never claimable, never
      // deleted (the archived row is the trail). matchClaim / getMyClaimCandidate
      // exclude it from duplicate counting so its resolved pair can be claimed.
      v.literal("archived_conflict"),
    ),
    match_signals: v.object({
      email: v.boolean(),
      name: v.boolean(),
      mobile: v.boolean(),
      dob: v.boolean(),
    }),
    conflict_reason: v.optional(v.string()),
    linked_member_id: v.optional(v.id("members")),
  })
    .index("by_normalized_email", ["normalized_email"])
    .index("by_claim_state", ["claim_state"])
    .index("by_legacy_row_id", ["legacy_row_id"]),

  // §4.3 ConsentRecord (append-only). Explicit false rows are written too, so
  // "she declined" is never confused with "never asked" (Codex 5).
  consentRecords: defineTable({
    member_id: v.id("members"),
    type: v.union(
      v.literal("terms_privacy"),
      v.literal("marketing"),
      v.literal("pipeline"),
    ),
    value: v.boolean(),
    policy_version: v.string(),
    source: v.union(
      v.literal("join"),
      v.literal("claim"),
      v.literal("settings"),
    ),
    timestamp: v.number(),
  }).index("by_member_type_time", ["member_id", "type", "timestamp"]),

  // §4.3 GuardianConsent: under-18 confirmation.
  guardianConsents: defineTable({
    member_id: v.id("members"),
    guardian_name: v.string(),
    guardian_email: v.string(),
    confirmation_state: v.union(
      v.literal("pending"),
      v.literal("confirmed"),
      v.literal("expired"),
    ),
    confirmation_token_hash: v.string(),
    // When the CURRENT token was emailed; expiry runs 30 days from here.
    // Absent on rows created before this slice's send flow stamps them.
    token_sent_at: v.optional(v.number()),
    // The consent PROOF (vault: what we record): when the guardian confirmed
    // and which policy version they agreed to. Set only on confirmation.
    confirmed_at: v.optional(v.number()),
    policy_version: v.optional(v.string()),
    timestamp: v.number(),
  })
    .index("by_member", ["member_id"])
    .index("by_token_hash", ["confirmation_token_hash"]),

  // §4 PipelineEligibilityReview (Codex 4): a profile reaches partners only
  // after opt-in AND this review approves (Age & Gender Verification stance).
  pipelineEligibilityReviews: defineTable({
    member_id: v.id("members"),
    state: v.union(
      v.literal("pending"),
      v.literal("approved"),
      v.literal("rejected"),
    ),
    reviewer: v.optional(v.string()),
    reason: v.optional(v.string()),
    timestamp: v.number(),
  })
    .index("by_member", ["member_id"])
    .index("by_state", ["state"]),

  // §8 AuditLog: mandatory, immutable, append-only row per member-affecting write.
  auditLog: defineTable({
    actor: v.string(),
    role: v.string(),
    action: v.string(),
    target_id: v.string(),
    before_summary: v.optional(v.string()),
    after_summary: v.optional(v.string()),
    request_id: v.optional(v.string()),
    timestamp: v.number(),
    source: v.union(
      v.literal("member"),
      v.literal("admin_fallback"),
      v.literal("agent"),
      v.literal("system"),
    ),
  })
    .index("by_target_time", ["target_id", "timestamp"])
    .index("by_actor_time", ["actor", "timestamp"])
    // Lets the admin audit view paginate source=admin_fallback DIRECTLY, so a
    // page can never be all member/system rows that hide older admin actions.
    .index("by_source_time", ["source", "timestamp"]),

  // §4.5 Certificate. Membership type auto-issues on join (the first win); all
  // other types are approve-first (later slice). The public verification page -
  // not the image - is the proof, so each row carries an UNGUESSABLE verify_token
  // (the public lookup key; the human-facing WAIME-MEM-#### label is derived from
  // the membership number and is never the lookup key, so the member list can't
  // be enumerated) and a `status` so verification tells the truth: valid /
  // superseded / revoked / not-found ([[02 Certificates - In-House Engine
  // (Decision)]] §6b "valid, superseded, revoked, or not found").
  certificates: defineTable({
    member_id: v.id("members"),
    type: v.union(v.literal("membership")),
    verify_token: v.string(),
    membership_number: v.number(),
    recipient_name: v.string(),
    issued_at: v.number(),
    issued_date_label: v.string(),
    is_founding: v.boolean(),
    status: v.union(
      v.literal("valid"),
      v.literal("superseded"),
      v.literal("revoked"),
    ),
    supersedes_id: v.optional(v.id("certificates")),
    // The admin's operational reason for a revoke, kept ON the record (not in
    // the immutable audit summary): the audit carries only the structured
    // fact that a reason was given (Gate 4 round 12 data minimisation).
    revoke_reason: v.optional(v.string()),
    template_version: v.string(),
    idempotency_key: v.string(),
  })
    .index("by_member", ["member_id"])
    .index("by_verify_token", ["verify_token"])
    .index("by_idempotency_key", ["idempotency_key"]),

  // Atomic sequence counters (e.g. the membership number). Convex serialises
  // writes per document, so a read-modify-write in one mutation is safe.
  counters: defineTable({
    name: v.string(),
    value: v.number(),
  }).index("by_name", ["name"]),

  // §4.6 ActivityLog: append-only first-party events for KPIs + the join
  // funnel, SPLIT from auditLog (security/ops). Lean by decision: one row
  // per KPI signal, no payloads, no free text. Funnel rows are written for
  // EVERYONE including minors; minors are excluded only from partner/impact
  // surfaces, never from operational counting (PRD Phase 2 §6.2).
  activityLog: defineTable({
    member_id: v.optional(v.id("members")),
    type: v.union(
      v.literal("join_submitted"),
      v.literal("email_confirmed"),
      v.literal("onboarding_started"),
      v.literal("claim_completed"),
      v.literal("rsvp_confirmed"),
      v.literal("event_checked_in"),
      v.literal("application_submitted"),
      v.literal("pipeline_opted_in"),
    ),
    // Dedup key where one real-world act could write twice (the event id for
    // RSVPs/check-ins, so a cancel-and-rebook or a corrected attendance mark
    // never double-counts). A Convex id string, never free text.
    ref: v.optional(v.string()),
    at: v.number(),
  })
    .index("by_type_time", ["type", "at"])
    .index("by_member_type", ["member_id", "type"])
    .index("by_time", ["at"]),

  // Fixed-window rate-limit buckets (security-hardening slice). One row per
  // key (e.g. "signin:<email>" or "signin:global"); windows roll forward in
  // place, so the table stays as small as the number of distinct keys.
  rateLimits: defineTable({
    key: v.string(),
    window_start: v.number(),
    count: v.number(),
  }).index("by_key", ["key"]),

  // §4.6 DataRequest: the deferred PRD §6.5 route (admin-panel slice). A subject
  // asks to see or erase her data; the row is a record only, never a side effect
  // on any member row (submitting is not approving). state runs
  // submitted -> identity_pending -> approved -> fulfilled|rejected.
  // verification_method + approver are set at approval, not creation.
  dataRequests: defineTable({
    subject_email: v.string(),
    linked_member_id: v.optional(v.id("members")),
    kind: v.union(v.literal("export"), v.literal("erasure")),
    state: v.union(
      v.literal("submitted"),
      v.literal("identity_pending"),
      v.literal("approved"),
      v.literal("fulfilled"),
      v.literal("rejected"),
    ),
    verification_method: v.optional(v.string()),
    approver: v.optional(v.string()),
    created_at: v.number(),
    decided_at: v.optional(v.number()),
    fulfilled_at: v.optional(v.number()),
  })
    .index("by_state", ["state"])
    .index("by_subject_email", ["subject_email"]),

  // ---------------------------------------------------------------------
  // panel-experience slice (Stage 0 §4.5 shapes): events, opportunities,
  // notifications, partners, standing history, admin notes. Archive/close,
  // never hard-delete; every admin write is a named action + audit row.
  // ---------------------------------------------------------------------

  // §4.5 Event. Capacity is the host tool's attendee limit (MVP rule); the
  // waitlist auto-promotes and every promotion is audited + notified. Youth
  // lane members only ever see audience_lane = "youth" events.
  events: defineTable({
    title: v.string(),
    category: v.union(
      v.literal("workshop"),
      v.literal("story_session"),
      v.literal("briefing"),
      v.literal("skills_clinic"),
      v.literal("meetup"),
      v.literal("conference"),
    ),
    short_description: v.string(),
    description: v.optional(v.string()),
    starts_at: v.number(),
    ends_at: v.number(),
    timezone: v.string(), // display label, e.g. "GST"
    format: v.union(v.literal("online"), v.literal("in_person")),
    meeting_link: v.optional(v.string()), // online: the host's own tool (MVP)
    venue: v.optional(v.string()),
    city: v.optional(v.string()),
    host_name: v.optional(v.string()),
    host_email: v.optional(v.string()), // never shown to members
    audience_lane: v.union(v.literal("adult"), v.literal("youth")),
    capacity: v.optional(v.number()),
    registration_closes_at: v.optional(v.number()),
    priority_window_start: v.optional(v.number()),
    priority_window_end: v.optional(v.number()),
    state: v.union(
      v.literal("draft"),
      v.literal("published"),
      v.literal("cancelled"),
      v.literal("postponed"),
      v.literal("attendance_finalized"),
    ),
    cancelled_reason: v.optional(v.string()),
    recording_url: v.optional(v.string()), // best-effort, members-only page
    materials_url: v.optional(v.string()),
    created_at: v.number(),
    published_at: v.optional(v.number()),
  })
    .index("by_state_start", ["state", "starts_at"])
    .index("by_starts_at", ["starts_at"]),

  // §4.5 RSVP. One row per member per event (idempotency key), state moves
  // registered <-> waitlisted -> attended | no_show, or cancelled by her.
  eventRegistrations: defineTable({
    event_id: v.id("events"),
    member_id: v.id("members"),
    state: v.union(
      v.literal("registered"),
      v.literal("waitlisted"),
      v.literal("cancelled"),
      v.literal("attended"),
      v.literal("no_show"),
    ),
    checkin_code: v.string(), // unguessable; the QR pass + check-in desk key
    promoted_from_waitlist_at: v.optional(v.number()),
    created_at: v.number(),
    updated_at: v.optional(v.number()),
  })
    .index("by_event_state", ["event_id", "state"])
    .index("by_member_time", ["member_id", "created_at"])
    .index("by_member_event", ["member_id", "event_id"])
    .index("by_checkin_code", ["checkin_code"]),

  // §4.5 Opportunity. Three decided types; evergreen takes no applications
  // (members claim directly from the partner). Deadlines are GST-labelled and
  // the cron closes open opportunities past their deadline.
  opportunities: defineTable({
    title: v.string(),
    partner_name: v.optional(v.string()),
    type: v.union(
      v.literal("competitive"),
      v.literal("single_winner"),
      v.literal("evergreen"),
    ),
    description: v.string(),
    what_to_submit: v.optional(v.string()),
    eligibility_note: v.optional(v.string()),
    how_to_claim: v.optional(v.string()), // evergreen only
    audience: v.union(v.literal("women_only"), v.literal("open")),
    deadline: v.optional(v.number()), // absent for evergreen
    anchor_event_id: v.optional(v.id("events")),
    state: v.union(
      v.literal("draft"),
      v.literal("open"),
      v.literal("closed"),
      v.literal("decided"),
    ),
    // The admin's operational reason for an early close, kept ON the record;
    // the audit summary carries only reason_present (Gate 4 round 12).
    close_reason: v.optional(v.string()),
    created_at: v.number(),
    published_at: v.optional(v.number()),
    result_published_at: v.optional(v.number()),
  })
    .index("by_state_deadline", ["state", "deadline"])
    .index("by_state_time", ["state", "created_at"]),

  // §4.5 Application. One per member per opportunity (by_member_opportunity);
  // every applicant gets an acknowledgement and a result, win or lose.
  opportunityApplications: defineTable({
    opportunity_id: v.id("opportunities"),
    member_id: v.id("members"),
    statement: v.optional(v.string()),
    state: v.union(
      v.literal("received"),
      v.literal("shortlisted"),
      v.literal("won"),
      v.literal("lost"),
      v.literal("withdrawn"),
    ),
    result_note: v.optional(v.string()),
    created_at: v.number(),
    decided_at: v.optional(v.number()),
  })
    .index("by_opportunity_state", ["opportunity_id", "state"])
    .index("by_member_time", ["member_id", "created_at"])
    .index("by_member_opportunity", ["member_id", "opportunity_id"]),

  // §4.6 Notification: in-app channel now, email when Resend Pro lands
  // (recorded deferral). Payload is display-ready and PII-light.
  notifications: defineTable({
    member_id: v.id("members"),
    type: v.union(
      v.literal("event_rsvp"),
      v.literal("event_waitlist_promoted"),
      v.literal("event_update"),
      v.literal("application_received"),
      v.literal("application_result"),
      v.literal("certificate_issued"),
      v.literal("standing_change"),
    ),
    title: v.string(),
    body: v.string(),
    href: v.optional(v.string()),
    channel: v.union(v.literal("in_app")),
    read_at: v.optional(v.number()),
    created_at: v.number(),
  }).index("by_member_time", ["member_id", "created_at"]),

  // §4.4 StandingHistory: append-only, every standing change auditable.
  standingHistory: defineTable({
    member_id: v.id("members"),
    from_standing: v.string(),
    to_standing: v.string(),
    reason: v.string(), // plain words, e.g. "profile complete + attended an event"
    timestamp: v.number(),
  }).index("by_member_time", ["member_id", "timestamp"]),

  // §4.6 Partner: admin-managed relationship record (MOU outcome = tier,
  // committed vs delivered, seal). No corporate login ships this phase; shapes
  // stay compatible with the later self-serve Partner Portal.
  partners: defineTable({
    name: v.string(),
    tier: v.union(
      v.literal("supporter"),
      v.literal("partner"),
      v.literal("champion"),
    ),
    status: v.union(
      v.literal("prospect"),
      v.literal("active"),
      v.literal("lapsed"),
      v.literal("declined"),
    ),
    contact_name: v.optional(v.string()),
    contact_email: v.optional(v.string()),
    website: v.optional(v.string()),
    mou_signed_on: v.optional(v.string()), // date label
    term_months: v.optional(v.number()), // default 12 at the boundary
    committed_value: v.optional(v.string()), // outcome-led text, never invoiced by WAI-ME
    deliverables: v.optional(
      v.array(
        v.object({
          label: v.string(),
          status: v.union(
            v.literal("committed"),
            v.literal("in_progress"),
            v.literal("delivered"),
            v.literal("part_delivered"),
          ),
        }),
      ),
    ),
    seal: v.union(
      v.literal("none"),
      v.literal("granted"),
      v.literal("withdrawn"),
    ),
    logo_storage_id: v.optional(v.id("_storage")),
    show_publicly: v.boolean(),
    notes: v.optional(v.string()),
    created_at: v.number(),
  }).index("by_status", ["status"]),

  // Admin notes on a member record: short, attributed, append-only in
  // practice (no edit path). Never shown to the member.
  adminNotes: defineTable({
    member_id: v.id("members"),
    author: v.string(), // admin email, from the session
    text: v.string(),
    created_at: v.number(),
  }).index("by_member_time", ["member_id", "created_at"]),

  // Agent access keys: a per-super-admin bearer secret that lets that admin's
  // OWN AI agent (Codex or any MCP client) call the curated agent surface in
  // convex/agent.ts - and nothing else. Only the SHA-256 hash is stored
  // (guardian-token precedent); the plain key exists once, at issue time. A
  // key is valid only while its owner is STILL on SUPER_ADMIN_EMAILS (checked
  // on every call), so removing an admin silently revokes her agent too.
  agentKeys: defineTable({
    admin_email: v.string(), // lower-cased owner; the audit actor for agent writes
    key_hash: v.string(),
    label: v.string(),
    created_at: v.number(),
    revoked_at: v.optional(v.number()),
    last_used_at: v.optional(v.number()),
  }).index("by_hash", ["key_hash"]),
});
