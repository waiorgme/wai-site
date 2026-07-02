# Spec: optin-toggles slice (Gate 1)

Date: 2026-07-02. Branch: build/optin-toggles (stacked on build/claim-wave).
Vault sources: `02 Member Profile Field Spec (Talent Pipeline)` Group H (the two toggles, both
default OFF, locked off for under-18, exact labels + plain-language tips), rule 4 (partners never
get raw contact details; WAI-ME brokers), rule 6 + `02 Age & Gender Verification Stance (Decision)`
(pipeline ON triggers the truthful-declaration attestation), `02 Stage 0` §4 PipelineEligibilityReview
+ §7 setPipelineOptIn/decidePipelineReview (profile reaches partners only after opt-in AND an
approved review), `01 Under-18 Members & Mentorship Safeguards (Decision)`, audit register SAFE-1.

## Acceptance criteria
1. **Schema**: members gain `directory_visible` (optional bool; absent = off) and `pipeline_state`
   (`off` | `review_pending` | `on` | `rejected`; absent = off). New `pipelineEligibilityReviews`
   table per Stage 0 §4 (member_id, state pending/approved/rejected, reviewer, reason, timestamp;
   indexes by_member and by_state).
2. **setDirectoryVisible (member)**: keyed off the auth user; lanes `minor` and `restricted_unknown`
   are refused server-side (locked off); audited.
3. **setPipelineOptIn (member)**: keyed off the auth user; lanes `minor`/`restricted_unknown`
   refused. ON requires `attestation: true`, writes a `pipeline` consent row (value true, source
   settings), opens a PipelineEligibilityReview (pending) idempotently, sets
   `pipeline_state = review_pending`. OFF writes the explicit false consent row, sets
   `pipeline_state = off`, and closes any pending review as rejected with reason
   `withdrawn_by_member`. Audited both ways.
4. **decidePipelineReview (admin fallback, internal)**: run by Issam via `npx convex run` until the
   admin surface exists (Stage 0: the fallback path). Approves/rejects a pending review, sets the
   member's `pipeline_state` (`on` / `rejected`), audits with reviewer name. Idempotent per review.
5. **Settings UI ("Your choices") on the dashboard**: a tile opens a settings panel showing both
   toggles with the field spec's EXACT labels and plain-language tips (Group H + microcopy table).
   Directory toggle flips immediately. Pipeline toggle ON expands the attestation confirm before it
   submits; the pending state is shown honestly ("A team member checks this once, then partners can
   find you"); rejected shows a neutral "not right now" with the support route. For members under
   18 the panel shows one plain line ("These options open when you turn 18.") and no controls.
6. **SAFE-1 closed**: `updateProfile` strips mentorship "looking for" options server-side for
   lanes `minor`/`restricted_unknown` (mirrors the join guard); the ProfileEditor hides those two
   options for minors.
7. **Partner search remains unbuilt**: nothing in this slice exposes any profile to anyone; the
   toggles only set state that the future partner surface must respect (recorded for that slice:
   filter = `pipeline_state == "on"` AND lane standard AND latest pipeline consent true).
8. **Tests**: unit tests for the new pure rules (toggle eligibility by lane, pipeline state
   machine transitions); suites stay green.
9. **No behaviour beyond this spec.** The ally question (may allies enter the pipeline?) follows
   the join/claim precedent already shipped: allowed, pending any owner override.

## Ops obligation (Gate 3 fix; recorded in the vault field-spec note too)
The pending copy promises "A team member checks this once". Honoured by a NAMED routine: **Issam
runs `npx convex run pipelineReviews:pendingCount` twice a week** (and after any comms push that
mentions opportunities) **and decides each pending review within 3 working days** via
`npx convex run pipelineReviews:decide '{"reviewId":"...","decision":"approved","reviewer":"Issam"}'`.
Pipeline consent has exactly one path (setPipelineOptIn); writeConsent refuses the pipeline type
outright so no consent row can ever skip the attestation + review.

## Out of scope, recorded
- The partner talent-search surface and the brokered-introduction flow (Phase 3 slice).
- The admin review UI (fallback = npx convex run, per Stage 0).
- Directory browsing itself (member-to-member directory is a later slice; the toggle stores intent).
