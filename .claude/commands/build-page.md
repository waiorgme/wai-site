---
description: Build one WAI-ME page through the full five-gate harness (Spec → Build → Design review → Codex source-of-truth audit → Interaction tests), then wait for human approval.
argument-hint: <page> (home | about | membership | get-involved | events | contact)
---

Build the **$1** page for the WAI-ME site through the harness. Run the gates in order and do
not skip or collapse the independent gates (design review, source-of-truth audit, interaction tests).

**Repo root.** The build repo is `/Users/ismac/Documents/Projects/wai-site` — this session may be
rooted in the vault instead, so do not assume the current directory is the repo. Run every repo
command (git, `npm`, the Codex script) against that absolute path, and when you launch the build
and design-review agents, tell them the repo root is that path so they use absolute paths too.

First load the `wai-source-of-truth` skill so the vault path and the brand locks are in context.

**Gate 0 — Branch (never build on `main`).** Branch off `main` before any gate work:
`git -C /Users/ismac/Documents/Projects/wai-site switch -c build/$1` (if the branch already exists
from an earlier attempt, switch to it). All gate work and fix loops are committed on this branch.
`main` only ever holds pages that cleared all five gates and human approval. Never commit page work
directly to `main`; never force-push.

**Gate 1 — Spec (Stop-the-Line).** Launch the `wai-spec` agent for `$1`. If it returns
`BLOCKED`, stop here, report exactly what vault note is missing, and ask the user — do not
invent requirements.

**Gate 2 — Build.** With a READY spec, launch the `wai-builder` agent. It builds the page as
Astro components, reusing the v3 design, adding nothing beyond the spec. If the page has any
interactive behaviour (filters, pagination, tabs, forms, multi-step flows), the Builder also writes
Playwright tests for it under `tests/e2e/`, asserting on what the browser actually renders
(visibility, counts, navigation) rather than on internal state or attributes. It must end with a
clean `npm run build` and, for any behaviour it added or changed, a green `npm run test:e2e`.

**Gate 3 — Design review (independent).** Launch the `wai-design-review` agent. It verifies the
page in the browser preview against the v3 design system and iterates with the Builder until it
returns `PASS`. This gate cannot be skipped.

**Gate 4 — Source-of-truth audit (independent, Codex, automated).** Run the bridge:
```
bash /Users/ismac/Documents/Projects/wai-site/scripts/codex-audit.sh $1
```
This launches Codex non-interactively (read-only) to audit the built page against the vault and
writes a structured verdict to `.codex/audits/$1.verdict.json` (exit 0 = PASS, 1 = FAIL, 2 = could
not run). **Do not copy/paste anything** — read the verdict file yourself and act on it:
- **FAIL:** take `required_fixes` from the verdict, hand them to `wai-builder` to fix, rebuild, then
  re-run `bash /Users/ismac/Documents/Projects/wai-site/scripts/codex-audit.sh $1`. Loop until PASS. Surface `orphan_claims` to the user only
  if they reveal the vault is genuinely missing a fact (then it is a Stop-the-Line, not a build bug).
- **exit 2 (could not run):** tell the user Codex could not run and do **not** mark the page done —
  this gate is non-collapsible.

**Gate 5 — Interaction tests (automated, Playwright, non-collapsible).** Run the full accumulated
end-to-end suite:
```
npm --prefix /Users/ismac/Documents/Projects/wai-site run test:e2e
```
It builds, serves on an isolated port, and drives a real headless browser, asserting on **rendered**
state (`:visible`, navigation, counts) — the layer that deterministically catches broken behaviour a
design-review eyeball misses. Every page's tests run, new and old, so a change that breaks an earlier
feature fails here. **Red:** hand the failing test names and messages to `wai-builder`; fix the code
(not the test, unless the test itself is genuinely wrong), rebuild, and re-run until green. A page
whose interaction is broken, or that breaks another page's tests, is not done.

**Human gate.** Summarise the verdicts plainly for Issam/Mervat (design review, source-of-truth, and
interaction tests) and ask for approval. Only on a
yes: run `/handoff` to log it in the vault (attach the verdict path as evidence). Report the page
route and how to preview it.

**Gate 6 — Merge.** Only after approval and the `/handoff` entry: commit any remaining work on
`build/$1`, then run the full suite one last time as the **merge condition** —
`npm --prefix /Users/ismac/Documents/Projects/wai-site run test:e2e` must be green (every accumulated
test, new and old, so nothing previously working has broken). Only then fast-forward it into `main`
and delete the branch (`R=/Users/ismac/Documents/Projects/wai-site`):
```
git -C $R switch main && git -C $R merge --ff-only build/$1 && git -C $R branch -d build/$1
```
If `main` has moved on and a fast-forward is refused, stop and tell the user rather than forcing a
merge. If the user did **not** approve (requested changes), stay on `build/$1`, loop the relevant
gate, and do not merge.
