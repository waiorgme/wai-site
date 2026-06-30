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
    claim_state: v.union(
      v.literal("unclaimed"),
      v.literal("claim_in_progress"),
      v.literal("claimed"),
      v.literal("conflict"),
      v.literal("suppressed_minor"),
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
    .index("by_claim_state", ["claim_state"]),

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
    timestamp: v.number(),
  }).index("by_member", ["member_id"]),

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
    .index("by_actor_time", ["actor", "timestamp"]),

  // §4.5 Certificate. Membership type auto-issues on join (the first win); all
  // other types are approve-first (later slice). The public verification page —
  // not the image — is the proof, so each row carries an UNGUESSABLE verify_token
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
});
