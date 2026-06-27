---
description: Build one WAI-ME page through the full four-gate harness (Spec → Build → Design review → Codex source-of-truth audit), then wait for human approval.
argument-hint: <page> (home | about | membership | get-involved | events | contact)
---

Build the **$1** page for the WAI-ME site through the harness. Run the gates in order and do
not skip or collapse the two independent gates (design review, source-of-truth audit).

First load the `wai-source-of-truth` skill so the vault path and the brand locks are in context.

**Gate 0 — Branch (never build on `main`).** From the repo root, branch off `main` before any
gate work: `git switch -c build/$1` (if the branch already exists from an earlier attempt, switch
to it). All gate work and fix loops are committed on this branch. `main` only ever holds pages
that cleared all four gates and human approval. Never commit page work directly to `main`; never
force-push.

**Gate 1 — Spec (Stop-the-Line).** Launch the `wai-spec` agent for `$1`. If it returns
`BLOCKED`, stop here, report exactly what vault note is missing, and ask the user — do not
invent requirements.

**Gate 2 — Build.** With a READY spec, launch the `wai-builder` agent. It builds the page as
Astro components, reusing the v3 design, adding nothing beyond the spec. It must end with a
clean `npm run build`.

**Gate 3 — Design review (independent).** Launch the `wai-design-review` agent. It verifies the
page in the browser preview against the v3 design system and iterates with the Builder until it
returns `PASS`. This gate cannot be skipped.

**Gate 4 — Source-of-truth audit (independent, Codex, automated).** Run the bridge from the repo root:
```
bash scripts/codex-audit.sh $1
```
This launches Codex non-interactively (read-only) to audit the built page against the vault and
writes a structured verdict to `.codex/audits/$1.verdict.json` (exit 0 = PASS, 1 = FAIL, 2 = could
not run). **Do not copy/paste anything** — read the verdict file yourself and act on it:
- **FAIL:** take `required_fixes` from the verdict, hand them to `wai-builder` to fix, rebuild, then
  re-run `bash scripts/codex-audit.sh $1`. Loop until PASS. Surface `orphan_claims` to the user only
  if they reveal the vault is genuinely missing a fact (then it is a Stop-the-Line, not a build bug).
- **exit 2 (could not run):** tell the user Codex could not run and do **not** mark the page done —
  this gate is non-collapsible.

**Human gate.** Summarise both verdicts plainly for Issam/Mervat and ask for approval. Only on a
yes: run `/handoff` to log it in the vault (attach the verdict path as evidence). Report the page
route and how to preview it.

**Gate 5 — Merge.** Only after approval and the `/handoff` entry: commit any remaining work on
`build/$1`, then fast-forward it into `main` and delete the branch:
```
git switch main && git merge --ff-only build/$1 && git branch -d build/$1
```
If `main` has moved on and a fast-forward is refused, stop and tell the user rather than forcing a
merge. If the user did **not** approve (requested changes), stay on `build/$1`, loop the relevant
gate, and do not merge.
