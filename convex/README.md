# Member portal backend (Convex)

This directory is the Convex backend for the WAI-ME member portal. It is built to
the locked **Stage 0 technical design** in the vault (`02 Platform/02 Stage 0 -
Technical Design (Public Site & Portal).md`). Don't re-argue the architecture
here — change the vault decision first.

## What's in this slice (signup + login)

- `schema.ts` — Member (lifecycle + age block), ImportedMember (claim),
  ConsentRecord, GuardianConsent, AuditLog, plus Convex Auth tables. Later slices
  add events, opportunities, certificates, the recognition ledger, and the
  privacy/ops entities (Stage 0 §4).
- `auth.ts` — Convex Auth, **magic-link only** via Resend (15-min single-use
  links, §8). On first verified sign-in, links the auth user to the member row
  created at join and advances the lifecycle (§6).
- `members.ts` — `submitJoin` (verifies Turnstile, creates the member +
  writes all three consent rows including explicit `false`), `writeConsent`.
- `lib/` — `memberLane` (the §5 server-side restriction evaluator), `lifecycle`
  (the §6 allowed transitions), `age` helpers, `audit` (the mandatory §8 writer).

## Running it (needs the dev deployment + secrets — Issam)

1. Create a Convex project, region **EU West (Ireland)**.
2. `npx convex deployment token create dev --save-env` (writes `CONVEX_DEPLOY_KEY`
   into `.env.local`).
3. Set `AUTH_RESEND_KEY` and `TURNSTILE_SECRET_KEY` in `.env.local`.
4. `npm run convex:dev` — validates the schema, runs codegen, starts the dev
   deployment. Until this runs, `./_generated` does not exist and the function
   files won't typecheck (expected for a code-only scaffold).

Secrets live only in `.env.local` (git-ignored). The prod deploy key stays with
Issam — sole production push (Stage 0 §2).
