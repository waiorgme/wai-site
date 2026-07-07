# Slice spec: activity-log (ActivityLog + join funnel + kill-criteria counters)

Written 2026-07-07 (Gate 1). Continues PR #5 on branch build/panel-design (Issam,
2026-07-07: all pre-production work consolidates on this branch for Mervat's
staged review). Sources of truth, in the vault at
/Users/ismac/Documents/Projects/WAI:

- 02 Platform/02 PRD - Public Site & Member Portal (Phase 2-3).md §13
  (ActivityLog in the data model from the start of Phase 2; two-track
  measurement; the four kill-criteria counters + the review date "into the
  dashboard"; "2+ missed → pause" is settled, figures tunable)
- 02 Platform/02 PRD Phase 2 - Public Site & Join Flow.md §6.2 (join funnel
  instrumented in ActivityLog: submitted → email-confirmed →
  onboarding-started, for EVERYONE, minors included)
- 02 Platform/02 Stage 0 - Technical Design (Public Site & Portal).md §4.6
  (ActivityLog append-only, split from security/ops logs; minors excluded
  only from partner/impact surfaces, never from operational funnel counting)
- 02 Platform/02 Measurement & Impact Metrics (Decision).md (first-party
  event log in Convex; event types kept lean, matching the KPI list, never
  "log everything"; partner impact always aggregate, never individuals)

## A. Data model

1. `activityLog` table, append-only, split from `auditLog`: `member_id`
   (optional id), `type` (closed union below), `at` (ms). Indexes for
   counting by type/time, the once-per-member guard, and trailing-window
   scans. No payloads, no free text, no PII beyond the member reference:
   the KPI list needs counts, not detail.
2. Event types (lean, one per KPI signal):
   - `join_submitted` - a Join form submission created the member row
     (everyone, minors included)
   - `email_confirmed` - the magic link was redeemed and the lifecycle
     advanced out of email_unverified (all lanes, whatever the next state)
   - `onboarding_started` - first profile save after activation (once per
     member; a second save is not a second onboarding)
   - `claim_completed` - a migrated member finished matchClaim
   - `rsvp_confirmed`, `event_checked_in` (attended only, never no-show),
     `application_submitted`, `pipeline_opted_in` - the engagement signals
     the KPIs and monthly-active read

## B. Instrumentation (server-side only, inside the same mutation txn)

3. createPendingMember → `join_submitted`. The MINOR path writes it too
   (PRD §6.2 bold requirement).
4. The email-confirm lifecycle advance (auth beforeSessionCreation) moves to
   a lib function (behavior identical) and writes `email_confirmed` - for
   active, pending_guardian AND pending_review outcomes alike.
5. updateProfile (first successful save) → `onboarding_started`, once.
6. matchClaim success → `claim_completed`.
7. events.rsvp success (registered or waitlisted) → `rsvp_confirmed`;
   admin checkIn marking attended → `event_checked_in`.
8. opportunities.apply success → `application_submitted`.
9. The member pipeline opt-in request (state → review_pending) →
   `pipeline_opted_in`.

## C. Dashboard counters (admin Reports, super-admin only)

10. New query `admin/overview.getPlatformHealth`, requireSuperAdmin first,
    returning aggregate counts only (no rows, no names):
    - funnel: all-time counts of the three join-funnel steps
    - monthly_active: distinct members with any activity row in the
      trailing 30 days
    - the four kill-criteria counters (PRD §13, thresholds tunable):
      claim rate vs ~25% (claimed/registered from importedMembers);
      event floor per trailing 6 calendar months vs 1/month; corporate
      partners with active status vs zero; monthly active vs ~15% of
      claimed members
    - the fixed 6-month review date, read from the counters row
      `platform_review_at` when the owner sets it at launch; null until
      then (the UI words that honestly)
11. ReportsView renders the funnel and a kill-criteria panel with plain
    words for Mervat: each counter says what it counts, the settled rule
    ("pause heavy build and rethink if 2 or more are missed"), and shows
    "set at launch" while pre-launch measures are null. No gold, no
    export, aggregates only.

## D. Proof

12. Vitest: the three funnel rows written exactly once through the real
    mutations (including a minor's join); onboarding_started not duplicated
    on a second profile save; claim/apply/rsvp/check-in rows written;
    getPlatformHealth denied to non-admins; monthly_active counts distinct
    members; kill-criteria arithmetic correct on seeded data.
13. npx tsc --noEmit, npm run check, npm test, npm run build, npm run
    test:e2e all green. Gate 4 covered by the consolidated
    panel-experience review on this branch.

## Deferrals (recorded, honest)

- PlacementLog (lagging KPI, Phase 5 partner impact) - the decision note
  makes its plumbing a Phase 2 *decision*, not a Phase 2 build; the
  activityLog table is that plumbing. No placement events until the
  partner phase defines them.
- Cloudflare Web Analytics toggle is an infrastructure owner action
  (Track 1), not code in this repo.
- Kill-criteria "months missed" is computed over the trailing 6 calendar
  months until launch sets the review window.
