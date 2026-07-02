# Spec: claim-wave slice (Gate 1)

Date: 2026-07-02. Branch: build/claim-wave (stacked on build/trust-pages).
Vault sources: `02 Migration & Claim-Wave Plan (Decision)` (Decision 1: the broadcast email carries
no token; the member enters her email on the site, gets a fresh magic link, and FIRST LOGIN matches
her to her imported record - that is the claim), `02 Stage 0 - Technical Design` §4.2
(ImportedMember conflict model), §6 ([migrated] claim_pending -> active on claim matched +
consent), §7/7.1 (startClaim neutral response; matchClaim post-login), §4.3 (consent rows at claim
incl. explicit false, source "claim"), `02 Data Re-Use & Consent at Migration (Decision)`,
`01 Under-18 Members & Mentorship Safeguards (Decision)` (the 76+ who joined under 18 are HELD BACK
from the open claim wave), `03 Member List Cleanup - Findings` (1,309 rows, legacy WAIME-### numbers
exist), audit register DATA-1 (numbering reconciliation).

## Shape decisions this spec records
- **startClaim IS the portal sign-in.** Decision 1 says the login page issues the link; the portal
  sign-in form already does exactly that with a neutral response and rate limits. No separate
  /claim entry point is built; the claim-wave email links to /portal.
- **Numbering reconciliation (DATA-1):** migrated members keep their legacy WAIME-### number on
  their certificate. The new-signup counter must sit ABOVE the highest legacy number; the import
  raises the counter floor. The provisional base-2000 dev counter is superseded. Founding-member
  cutoff stays an owner rule (FOUNDING_MEMBER_LIMIT unchanged until Mervat/Issam set it).

## Acceptance criteria
1. **Import tooling (code only; Issam runs it).** `scripts/import-members.py` reads the cleaned
   xlsx ("Members (Cleaned)" sheet), validates + normalises rows (lower-cased email, legacy number
   parsed from WAIME-###, birthday to ISO if present), marks rows whose birthday makes them under
   18 TODAY as `suppressed_minor`, and pushes idempotent batches to an internal Convex mutation via
   `npx convex run`. Re-running never duplicates (idempotent on legacy_row_id; row-hash change
   updates). The member list itself is NEVER committed to the repo (PII); the script reads it from
   the vault path at run time. After import it raises the membership counter floor above the
   highest legacy number.
2. **Claim detection post-login.** When an authenticated user has NO member row, the portal asks
   the backend for a claim candidate by the proven email. If an unclaimed imported row exists, the
   dashboard shows the claim flow instead of "no member profile linked"; if none, the current
   message stays.
3. **Claim flow UI (plain language).** Greets her with the imported first name, asks her to
   confirm/correct her name, requires date of birth (gets migrated members out of the
   restricted_unknown lane), shows the three §6.3 consents (terms + attestation required;
   marketing/pipeline default OFF; pipeline hidden for minors), then calls `matchClaim`.
4. **matchClaim (mutation, member role).** Keyed off the auth user's email ONLY (magic link proved
   email control; a caller can never claim someone else's row). Outcomes:
   - clean: creates the Member row (source `migrated`, gender/mobile/legacy fields carried over,
     DOB self-declared at claim, lane evaluated server-side), writes all three consent rows
     (source `claim`, explicit false), marks the imported row `claimed` + `linked_member_id` +
     match_signals, lifecycle -> `active`, issues the membership certificate with the LEGACY
     number, audit rows throughout. Idempotent: claiming twice returns already.
   - DOB mismatch vs `dob_if_known` (different calendar date): imported row -> `conflict` with
     reason; NO member row is created; the member sees a friendly "a human will check and email
     you" message. Name difference alone is recorded as a match signal, not a conflict.
   - suppressed_minor or an already-claimed/conflict row: refused with the appropriate plain
     message (minors: guardian route later; already claimed: sign-in guidance/support).
   - a claimant whose claim makes her a minor NOW: refused to the same guardian route (never
     auto-activated).
5. **Certificates for migrated members** carry the legacy number (idempotency preserved); the
   counter floor guarantees new signups never collide with legacy numbers.
6. **Suppressed minors are invisible to the wave**: import marks them; matchClaim refuses them;
   nothing exposes their data.
7. **Integrity rule untouched:** imported-but-unclaimed rows never become `active` members;
   nothing counts them as active anywhere.
8. **Tests.** Unit tests for the pure claim lib (legacy-number parsing, row normalisation, minor
   suppression, DOB mismatch rule, counter floor math). E2E: existing suites stay green (the
   claim flow itself is auth-gated and dev-deployment-tested at UAT instead - recorded here).
9. **No behaviour beyond this spec.** The broadcast sending (EmailOctopus), warm-up batches,
   WhatsApp fallback, and guardian consent flow are later work; the §4.6 ActivityLog funnel stays
   deferred (recorded in the join spec).

## Wave-run obligations (Gate 3 fix 3; recorded in the vault plan too)
The claim UI promises "a team member will check and email you". That promise is honoured by a
NAMED ops routine during the wave, not by code: while the wave runs, Issam checks
`importedMembers` by `claim_state` (`conflict` + newly `suppressed_minor`) DAILY (Convex dashboard
or `npx convex run`), and the team emails those members within 2 working days. Aged-up members
unsuppress automatically at claim time (file-DOB check) and on any re-import with current data.
Also a pre-condition of the real import: **Mervat/Issam set the founding-member cutoff first**
(FOUNDING_MEMBER_LIMIT is a placeholder; certificates are shareable and a wrong founding badge can
only be fixed by superseding).

## Out of scope, recorded
- Real import run + UAT on the dev deployment (Issam; Claude is code-only there).
- Founding-member cutoff rule (owner decision; now a NAMED pre-condition of the import, above).
- Guardian-consent email flow for suppressed minors (minor-cert slice).
- The claim-wave email copy for EmailOctopus (comms task, vault-side).
- One duplicate-email pair in the cleaned list (dry run flagged row 646); resolve by hand before
  the import (Stage 0 wants two-people-one-email routed to manual review).
