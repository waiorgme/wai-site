# Spec: admin-panel slice (Gate 1)

Date: 2026-07-04. Branch: build/admin-panel (off main; main = post-public-switch, merges via PR).
Scope recorded in `05 Operations/05 Agent Handoff - Log.md` (2026-07-02b entry, "For you" list) and
`Tasks - What's Next.md`: **the minimal admin panel = claim conflicts queue + pipeline eligibility
reviews + pending guardians + the deferred DataRequest route (PRD §6.5)**. This is a portal feature
slice (authenticated, two-person surface), not a public page.

Vault sources: `02 Admin Approach - Agent-Operated.md` (propose-then-confirm on every change, fixed
menu of safe actions, an audit log, no bulk PII export, the fallback UI as a thin clickable face on
the same safe-actions the agent uses), `02 Admin Roles (Decision)` (exactly two super admins,
Mervat + Issam, live now; no role picker; Contributor and Safeguarding Deputy are described but
dormant, do not build), `02 Agent-Admin Resilience & Security (Decision)` Decision 1 (the fallback
UI must cover **every member-facing-critical action**, reusing the same safe-actions layer - this
slice is that fallback for the four queues it names) and Decision 3 (external/member-submitted text
is data, never instructions; propose-then-confirm; no bulk export), `02 Stage 0 - Technical Design`
§3 (roles: `admin` = Mervat + named backup approver Dina Bel Jaflah; `super_admin` = Issam - see
Open Questions, this slice builds to the Admin Roles decision's two-super-admin reality), §4.2
(ImportedMember claim_state incl. `conflict`/`suppressed_minor`, `conflict_reason`), §4.6
(DataRequest: `subject_email`, `linked_member_id?`, `kind` export|erasure, `state` submitted →
identity_pending → approved → fulfilled|rejected, `verification_method`, `approver`), §4 (
PipelineEligibilityReview: `member_id`, `state` pending|approved|rejected, `reviewer`, `reason`),
§4.3 (GuardianConsent: `confirmation_state` pending|confirmed|expired), §7/§7.1 (named action
contract: `approveFlaggedSignup`/`rejectFlaggedSignup`, `decidePipelineReview`,
`submitDataRequest`/`approveDataRequest`/`fulfilExport`/`executeErasure`, all admin actions carry a
fallback UI; result envelope `{ ok, error }` with named codes; every write audits), §8 (AuditLog
mandatory, immutable, PII-free summaries; negative test: a visitor cannot trigger deletion of
anyone else's data), `02 Migration & Claim-Wave Plan (Decision)` "Wave-run ops routine" (Issam
currently checks `conflict`/`suppressed_minor` imported-member rows by hand daily and emails those
members within 2 working days - this slice is the UI replacing that manual `npx convex run` check),
`02 Privacy & Data Protection (Decision)` (a valid erasure request triggers true deletion or
irreversible anonymisation, human-approval gate), `02 Data Export, Backup & Retention (Decision)`
§3 (a full-database export needs deliberate, explicit, separate approval - never bundled into a
routine action; standard format CSV/JSON for the one-subject export this slice does need),
`02 Privacy Policy & Guardian Consent (Draft)` line 73 (verbatim: "You can ask us to: see the data
we hold about you; correct it; delete it..."; "To exercise any of these, email
**support@waiorg.me**... (As the member area grows, these options will also appear there
directly.)"), `specs/trust-pages.spec.md` criterion 1 + `02 PRD Phase 2 - Public Site & Join Flow`
§6.5 dated deferral note (the DataRequest route + admin handling belongs here, basis: the approved
LEGAL-2 amendment made email-to-support the launch mechanism, not a blocker on this slice existing),
`specs/optin-toggles.spec.md` criterion 4 + its "Ops obligation" section (the pipeline INVARIANT -
attestation + eligibility review, never skipped - and the standing instruction this panel replaces:
Issam runs `pipelineReviews:decide` via `npx convex run` twice weekly until this panel exists),
`specs/guardian-consent.spec.md` "Out of scope, recorded" (admin visibility of pending/expired
guardian consents assigned to this slice) + its schema (GuardianConsent `confirmation_state`,
`token_sent_at`, no guardian PII in audit summaries), `01 Under-18 Members & Mentorship Safeguards
(Decision)` (a guardian's own confirmation press is the only route to `confirmed`; nothing in this
panel may substitute for it), `01 Branding.md` + `Home Design Tournament` v3 records (token set:
`--ink`, `--ink-2`, `--navy`, `--sky`, `--white`, `--mist`, `--r-card`, `--r-chip`, `--display`,
`--body`; gold is recognition-only and does not appear here), brand-lock copy rule (no em dashes;
every dash is a regular hyphen; no invented legal/policy copy).

Code sources read (branch `build/admin-panel` = main): `convex/schema.ts` (members, importedMembers,
consentRecords, guardianConsents, pipelineEligibilityReviews, auditLog, certificates, counters,
rateLimits - no `admins` or `dataRequests` table yet), `convex/members.ts` (`authedEmail`,
`matchClaim`'s conflict-marking at lines ~699-718, `getMySettings`/`setPipelineOptIn`),
`convex/importedMembers.ts` (`importBatch`, `raiseCounterFloor`, both `internalMutation` run only by
the import script), `convex/pipelineReviews.ts` (`decide` + `pendingCount`, both `internalMutation`/
`internalQuery` run only via `npx convex run` - this slice's job is to give these a real UI and a
real caller identity check, not to change their logic), `convex/guardians.ts` (guardian schema/
flow, no admin-facing query exists yet), `convex/lib/pipeline.ts` (`ensurePipelineReviewOnActivation`,
the invariant this slice must not bypass), `convex/lib/audit.ts` (`writeAudit`), `convex/auth.ts`
(no admin/role concept exists in the auth layer today - see Open Questions), `.env.example` (the
established pattern for security-sensitive config: named env vars set **on the deployment** via
`npx convex env set`, never committed, e.g. `TURNSTILE_SECRET_KEY`, `SITE_URL` - the precedent this
slice's admin allowlist follows), `src/portal/ui.ts` (the shared brand-token style constants: `card`,
`panel`, `h1`, `muted`, `primaryBtn`, `linkBtn`, `dl`, `chip`/`chipActive`, `errorText` - reused, not
reinvented, for the admin surface), `src/portal/PortalApp.tsx` + `src/pages/portal/index.astro`
(the existing `Authenticated`/`Unauthenticated`/`AuthLoading` pattern this slice's `/admin` route
follows).

## Shape decisions this spec records

- **New `/admin` route, not a tab inside `/portal`.** The two super admins are also members (Mervat,
  Issam), but the fallback UI is a distinct surface so a member-facing bug can never leak admin
  controls to an ordinary session, and so `/admin`'s own layout can stay plain/utilitarian per the
  vault ("deliberately no-frills... the UI is the guarantee nothing is ever blocked"). `noindex`,
  `robots.txt`-disallowed, same as `/portal` and `/verify` (trust-pages precedent).
- **Server-side identity, not a role stored on the member row.** Membership rows model *members*;
  admin identity is deployment configuration, matching the established `TURNSTILE_SECRET_KEY`/
  `SITE_URL` pattern (env vars set on the deployment, never in the repo, never client-supplied).
  See criterion 1.
- **Four queues, one shared shell.** Claim conflicts, pipeline reviews, and pending guardians are
  three read-and-decide queues over existing tables; DataRequest is new (table + submit action +
  admin queue). All four share one propose-then-confirm interaction pattern and one audit
  convention, so this stays "a thin clickable face on the same safe-actions," not four bespoke UIs.
- **No new lifecycle/lane rules.** This slice adds *visibility and decision UI* over states the
  system already computes (`conflict`, `suppressed_minor`, `pending` reviews, `pending`/`expired`
  guardian consents). It does not change `evaluateMemberLane`, the lifecycle map, or the pipeline
  invariant.

## Acceptance criteria

1. **Admin identity check, server-side, on every admin query and mutation.** A super admin is
   identified by comparing the signed-in member's (lower-cased) email against an allowlist held in
   a deployment env var (e.g. `SUPER_ADMIN_EMAILS`, comma-separated), set via `npx convex env set`
   on each deployment, never committed to the repo (matches the `.env.example` precedent for
   `TURNSTILE_SECRET_KEY`/`SITE_URL`) and never accepted as a client-supplied argument. A single
   `requireSuperAdmin(ctx)` helper (new, `convex/lib/adminAuth.ts`) resolves the caller from
   `getAuthUserId`/`authedEmail`, checks the allowlist, and is called first in every function this
   spec adds; on failure it returns `{ ok: false, error: "not_authorized" }` (queries throw, per
   Stage 0 §7.1's named-error convention) without revealing which check failed. **Deny-by-default**
   (Stage 0 §3): an unset or empty allowlist means no one is admin, not "let anyone in." The `/admin`
   page itself hides all controls for a non-admin signed-in member and shows a neutral
   "not available" state (UI hiding is a courtesy; the server check above is what actually protects
   the data, per Stage 0 §3's deny-by-default rule).
2. **Claim conflicts queue.** A query (new, `convex/admin/claims.ts`,
   `listConflicts`, super-admin only) lists `importedMembers` rows with `claim_state` in
   (`conflict`, `suppressed_minor`), each showing: masked/partial identity (first name +
   last-initial, not the full row - this is a review queue, not a member-data browser),
   `conflict_reason`, `match_signals`, and days since the row last changed. Two actions:
   - `resolveConflictAsClaimed` (new mutation): for a `conflict` row, the admin picks which
     `importedMembers` row (of the duplicate-email pair, or the single ambiguous row) is the real
     match and confirms; sets that row's `claim_state` back to `unclaimed` (claimable again) or, if
     the member has since signed up separately, links it - **exact resolution mechanics for an
     already-active duplicate-email claim are an open question, see Open Questions**; the *other*
     row in a duplicate-email pair stays `conflict` until separately resolved (never auto-resolved
     by resolving its pair).
   - `dismissSuppressedMinor` is **not offered**: `suppressed_minor` rows clear automatically when
     the underlying record shows her 18 (existing `importBatch` logic, unchanged); the queue shows
     them read-only with the reason, so Mervat/Issam can see who is waiting and, per the recorded
     ops routine, email them personally within 2 working days if contact is warranted. No admin
     action forces a `suppressed_minor` row to claimable early (that would bypass the safeguarding
     age gate matchClaim itself enforces).
   Every state-changing action here is propose (show the two candidate rows / the reason) → confirm
   → mutation → §8 audit row (`source: "admin_fallback"`, actor = the admin's email, PII-free
   summary: row ids and states, never name/email/DOB of the member in the summary text).
3. **Pipeline eligibility reviews queue.** A query (new, `convex/admin/pipelineReviews.ts`,
   `listPendingReviews`, super-admin only) lists `pipelineEligibilityReviews` rows with
   `state = "pending"`, each showing the member's name, lane (must be `standard`, per the invariant),
   and how long the review has been open. One action, wrapping the **existing**
   `pipelineReviews.decide` logic (do not duplicate or fork it - convert it from `internalMutation`
   to a mutation callable only after `requireSuperAdmin`, or add a thin super-admin-gated wrapper
   that calls the same internal function, whichever keeps `npx convex run` still usable as a
   break-glass path per Decision 1): `decidePipelineReviewFromPanel({ reviewId, decision, reason? })`
   - reviewer is taken from the authenticated admin's identity, never a free-text field (closes a
   spoofing gap the current `npx convex run` fallback has, where `reviewer` is caller-supplied).
   Propose (show the pending review + member's attested consent) → confirm → decide → §8 audit
   (unchanged action name `decidePipelineReview`, `source: "admin_fallback"`). **The panel can never
   approve a review for a non-`standard` lane or skip the attestation check** - it calls the same
   function `setPipelineOptIn`/`ensurePipelineReviewOnActivation` already gate, so an ally, minor, or
   restricted-unknown row cannot reach `on` through this queue (Stage 0 §5, women-only pipeline).
   This closes the ops obligation recorded in `specs/optin-toggles.spec.md` ("Issam runs
   `npx convex run pipelineReviews:decide` twice a week... until the admin panel exists") - that
   obligation is now retired by this slice; record the retirement in the merge handoff.
4. **Pending guardians queue.** A query (new, `convex/admin/guardians.ts`, `listPendingGuardians`,
   super-admin only) lists `guardianConsents` rows with `confirmation_state` in (`pending`,
   `expired`), each showing: the member's first name + lane confirmation (`minor`), guardian name
   (first name + last-initial, not the full guardian email -§8's PII-minimisation applies to admin
   read surfaces too, not just audit summaries), `confirmation_state`, `token_sent_at`, and days
   waiting. This is **read-and-nudge, not consent bypass**: the only action available is
   `resendGuardianEmailFromPanel` (new, thin super-admin-gated wrapper around the **existing**
   `prepareGuardianSend`/send-action pair, reusing its rotation + rate-limit + audit behaviour
   exactly as the member's own "Send it again" does, so this doesn't fork a second send path) -
   there is **no button that sets `confirmation_state = confirmed`**. A guardian's own button press
   on `/guardian-confirm` remains the only route to `confirmed` (Under-18 decision, restated here as
   a hard constraint on this slice). Propose (show which guardian email will be resent) → confirm →
   send → existing audit trail (`sendGuardianEmail`/`resendGuardianEmail.refused` etc., unchanged).
5. **DataRequest: member-facing submission (the deferred PRD §6.5 route).**
   - **Schema (new):** `dataRequests` table per Stage 0 §4.6: `subject_email`, `linked_member_id`
     (optional), `kind` (`export` | `erasure`), `state` (`submitted` | `identity_pending` |
     `approved` | `fulfilled` | `rejected`), `verification_method` (optional until set at approval),
     `approver` (optional until approved), `created_at`/`decided_at`/`fulfilled_at` timestamps.
     Indexes: `by_state`, `by_subject_email`.
   - **`submitDataRequest` (new mutation, visitor + signed-in member, matches Stage 0 §7.1 shape
     `{ subject_email, kind }` → `{ requestId, state: 'submitted' }`).** Open to anyone (a visitor
     who is not yet signed in can still ask), Turnstile-gated the same way `submitJoin` is (reuse
     the existing Turnstile verification helper, do not fork a second one), rate-limited per-email
     to prevent spam-submission of someone else's address (reuse `convex/lib/rateLimit.ts`
     conventions). Writes only a record; **creates no side effect on any member row** (Stage 0 §8's
     negative test: a visitor cannot trigger deletion of anyone else's data - submitting is not
     approving). If `subject_email` matches an existing member, `linked_member_id` is set
     automatically (server-side lookup), never client-supplied. Audited (`source: "member"` if
     signed in, else `"system"`; PII-free summary: request id + kind only).
   - **Where it's reachable:** a small, honestly-scoped form. Given the privacy policy's shipped,
     Issam-approved sentence ("To exercise any of these, email support@waiorg.me... As the member
     area grows, these options will also appear there directly"), this slice is that "member area
     grows" moment for the **signed-in member's own settings panel** (a new "Your data" section
     alongside the existing "Your choices" toggle panel from `specs/optin-toggles.spec.md`, reusing
     `src/portal/Settings.tsx`'s pattern) - a member requests export or erasure of **her own**
     account, `subject_email` taken from her session, never a free-text field for a signed-in
     caller. **A public unauthenticated route is an open question** - see Open Questions; the
     privacy policy's verbatim launch mechanism (email support@waiorg.me) still stands for visitors
     and remains the footer/privacy-page link; this slice does not need to add a public unauthed
     form to satisfy the deferral, only the admin-handling side and the member's own settings route,
     unless the vault mandates the public form (checked, it does not - the LEGAL-2 amendment's
     "as the member area grows" language ties this feature to the *member* area specifically).
6. **DataRequest: admin queue.** A query (new, `convex/admin/dataRequests.ts`, `listDataRequests`,
   super-admin only) lists `dataRequests` rows in `submitted`/`identity_pending`, showing
   `subject_email`, `kind`, `linked_member_id` (resolved to a name if linked), and age. Actions,
   each propose → confirm → mutation → §8 audit, matching Stage 0 §7.1's contract exactly:
   - `approveDataRequest({ requestId, decision, verification_method })` - `verification_method` is
     a required short free-text field the admin fills describing how identity was confirmed (e.g.
     "matched signed-in session", "confirmed by reply from the email on file"); decision
     `approved`/`rejected`.
   - `fulfilExport({ requestId })` - **export kind only**, after approval. Produces the **single
     subject's** data (not a bulk export; the "no bulk personal-data export" guardrail governs
     multi-member exports, not a lawful one-subject access request) as CSV/JSON per the Data Export
     decision's stated format, surfaced as a one-time download the admin retrieves and sends to the
     subject manually (this slice does not build an automated emailing of personal data - matches
     the human-approval-gate spirit; automating delivery is a fast-follow, not required here).
     **Exact export shape/fields are an open question**, see Open Questions.
   - `executeErasure({ requestId })` - **erasure kind only**, after approval, super-admin only (not
     `admin`, per Stage 0 §3's role split putting revoke/erasure at `super_admin`). Performs
     **irreversible anonymisation** (per the Privacy & Data Protection decision: "true deletion or
     irreversible anonymisation... except the minimum the law or a live safeguarding matter requires
     us to keep") - scrubs name/email/mobile/photo/bio/profile fields on the linked member row (if
     any) to an anonymised placeholder, sets `lifecycle_state = archived` (Stage 0 §6's
     `erasure_requested → erasure_in_progress → archived` chain - this action performs the
     `erasure_in_progress → archived` step; setting `erasure_requested` happens at
     `submitDataRequest` time if `linked_member_id` was resolved), and **never deletes the AuditLog
     rows referencing her** (append-only, §8, this is what "except the minimum the law... requires"
     protects). Sets `dataRequests.state = "fulfilled"`. **Exact field-by-field anonymisation spec
     (what "scrub" means precisely, e.g. does a certificate's `recipient_name` get rewritten, does a
     verify-page lookup for an erased member's certificate now 404) is an open question**, see Open
     Questions - do not invent this at build time.
7. **Confirmation UI pattern, one shared component.** All four queues use one `<ConfirmAction>`-
   style pattern (new, small React component in `src/admin/`, reusing `src/portal/ui.ts` tokens):
   shows a plain-language summary of what will change, requires an explicit second click
   ("Yes, do this" / "Cancel"), and shows the resulting state inline (no silent success). This is
   the vault's "propose-then-confirm" rule made concrete, once, not reimplemented four times.
8. **Audit visibility, read-only.** The admin panel includes a simple, paginated, read-only view of
   recent `auditLog` rows filtered to `source = "admin_fallback"` (new query, `listAdminAuditLog`),
   so a super admin can see what the panel itself has done - this is the audit-log promise from
   `02 Admin Approach - Agent-Operated.md` made visible, not a new logging mechanism.
9. **Brand + copy locks.** `/admin` uses the existing token set (`--ink`, `--ink-2`, `--navy`,
   `--sky`, `--white`, `--mist`, `--r-card`, `--r-chip`) and `src/portal/ui.ts` primitives; it is
   utilitarian (tables/lists/buttons), not a marketing surface, and carries no gold accents (gold is
   recognition-only, `01 Branding.md`, and nothing here is a member-facing recognition moment). No
   em dashes anywhere in new copy; every dash is a regular hyphen. No invented legal/policy copy -
   the `verification_method` and `reason` fields are admin-authored operational notes, not published
   policy text, so they are exempt from "verbatim from the vault" but must never assert a legal
   position (e.g. must not claim GDPR/CCPA compliance status) not already stated in the vault's
   privacy decision.
10. **No bulk export, no enumeration, neutral errors.** No action anywhere in this slice returns or
    downloads more than one member's data at a time. No query in this slice accepts a raw email/name
    search across all members (the three existing queues and the new DataRequest queue all list
    *rows already in a review state*, never a general member search/browse - general member search
    is out of scope, see below). Every `not_authorized`/`not_found` failure returns the same neutral
    shape regardless of *why* (wrong admin, no such row, or row in the wrong state), matching Stage
    0 §7.1's named-error convention and the no-enumeration precedent set in
    `specs/guardian-consent.spec.md`.
11. **Tests.** Unit: `requireSuperAdmin` allowlist logic (allowed email, case-insensitivity, empty/
    unset allowlist denies, non-member signed-in caller denies). Convex integration (convex-test,
    matching the existing suites' pattern): a non-admin member is refused on every new query/
    mutation; a super admin can list and resolve one row in each of the four queues end-to-end with
    an audit row written; `decidePipelineReviewFromPanel` refuses a non-`standard`-lane review (this
    should be unreachable in data but the guard is tested anyway); `executeErasure` is refused for
    `admin`-role callers and only succeeds for the `super_admin` allowlist entry (Issam); a visitor
    calling `submitDataRequest` for someone else's email creates only a record, no member-row
    side-effect (Stage 0 §8's negative test, ported here). E2E: `/admin` renders its shell and
    `noscript`/`noindex` for the unauthenticated case (the suite runs without a Convex deployment,
    matching the guardian-consent precedent - authenticated queue rendering is exercised at the
    Convex layer plus the design-review gate, not by Playwright sign-in).
12. **No behaviour beyond this spec.** No Contributor role, no Safeguarding Deputy role or view (both
    explicitly "described but dormant" per `02 Admin Roles (Decision)` - do not build), no
    certificate revoke/reissue UI, no event/opportunity admin actions, no broadcast/messaging UI, no
    general member directory/search screen, no config/thresholds editor. These are named in Stage
    0 §7's action table and Decision 1's "critical actions" list as belonging to the fallback UI
    eventually, but are **not** part of the four queues this slice is scoped to; each is a future
    slice.

## Production gate (unchanged, restated)

This slice ships to staging only, like every prior slice. Nothing here touches a production Convex
deployment, the real member list, or waiorg.me. The `SUPER_ADMIN_EMAILS` allowlist is set
independently on each deployment (dev/staging/production) when that deployment exists; setting it on
staging now does not imply or authorize a production cutover. The standing rule stands: no production
step without Mervat's dated dry-run sign-off in `05 Operations/05 Agent Handoff - Log` plus Issam's
approval.

## Out of scope, recorded

- General member directory/search for admins (every queue here is scoped to rows already in a
  named review state; a full member browser is a distinct, higher-risk feature needing its own
  privacy review).
- Contributor role and Safeguarding Deputy role/view (`02 Admin Roles (Decision)`: defined, dormant,
  build only when a named person needs them).
- Certificate revoke/reissue/config-edit UI, event/opportunity publish UI, broadcast/messaging UI,
  Ambassador batch approval, ConductReport/`upholdConductReport` UI, `grantMentorRole` UI - all named
  in Stage 0 §7 as eventual fallback-UI actions, none are part of this slice's four named queues.
- Automated delivery of a fulfilled data export to the subject (this slice produces the export for
  the admin to send manually; automating that send is a fast-follow).
- A public, unauthenticated "request your data" web form (the privacy policy's shipped launch
  mechanism, email to support@waiorg.me, still stands for visitors; see criterion 5 and Open
  Question 3).
- Localised (Arabic) admin panel - English-first like the rest of the portal.

## Open Questions (Stop-the-Line on these three specifics; do not invent at build time)

1. **Claim-conflict resolution mechanics for the duplicate-email case.** Stage 0 §4.2 and the
   claim-wave spec establish that two `importedMembers` rows sharing one email both get marked
   `conflict` and that `matchClaim` reveals nothing to the claimant. Neither the vault nor the code
   specifies what a human admin's resolution actually *does* to the two rows once she has worked out
   (presumably by contacting both people, per the wave-run ops routine's "get a personal email"
   commitment) which one is real: does the non-matching row get manually deleted, relinked to a
   corrected email, or permanently left `conflict` with a note? Criterion 2 above intentionally
   leaves this open rather than inventing a resolution mechanic; needs an Issam/Mervat decision
   before this part of criterion 2 is built, or the builder should propose options at Gate 3 for
   sign-off rather than the spec dictating one.
2. **DataRequest export shape/fields, and what "irreversible anonymisation" scrubs field-by-field.**
   The Data Export decision says CSV/JSON, standard format, for a full-database export; it does not
   specify a single-subject export's exact field list. The Privacy & Data Protection decision says
   erasure is "true deletion or irreversible anonymisation... except the minimum the law... requires
   us to keep" but does not enumerate which fields survive anonymisation (e.g. does an anonymised
   member's certificate stay verifiable with a placeholder name, or does verification start
   returning not-found; do ContributionLedger/StandingHistory rows referencing her get scrubbed or
   kept for the organisation's own aggregate history). This needs a dated decision note before
   `fulfilExport`/`executeErasure` are implemented to the letter; criteria 6 names the actions and
   their gating (roles, states, audit) but the field-level behavior is intentionally left for that
   decision, not guessed here.
3. **Whether a public, unauthenticated DataRequest form is required or the email route fully
   satisfies the PRD §6.5 deferral.** The LEGAL-2 amendment's "as the member area grows, these
   options will also appear there directly" reads as scoped to the *member* area (criterion 5 builds
   exactly that). If Issam intends `submitDataRequest` to also be reachable by a logged-out visitor
   through a web form (not just support@waiorg.me email), that is a small additive scope this spec
   does not currently include; flagging rather than assuming either way.

Builder: proceed on criteria 1, 3, 4, 7, 8, 9, 10, 11, 12 and the parts of 2, 5, 6 that do not depend
on the three open questions (the queues' listing/visibility, the propose-confirm shell, the schema,
`submitDataRequest`'s creation-only behavior, `approveDataRequest`'s state transition and audit).
Halt and raise for a decision before writing `resolveConflictAsClaimed`'s row-mutation logic,
`fulfilExport`'s field list, or `executeErasure`'s scrub logic.
