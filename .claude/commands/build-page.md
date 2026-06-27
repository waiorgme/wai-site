---
description: Build one WAI-ME page through the full four-gate harness (Spec → Build → Design review → Codex source-of-truth audit), then wait for human approval.
argument-hint: <page> (home | about | membership | get-involved | events | contact)
---

Build the **$1** page for the WAI-ME site through the harness. Run the gates in order and do
not skip or collapse the two independent gates (design review, source-of-truth audit).

First load the `wai-source-of-truth` skill so the vault path and the brand locks are in context.

**Gate 1 — Spec (Stop-the-Line).** Launch the `wai-spec` agent for `$1`. If it returns
`BLOCKED`, stop here, report exactly what vault note is missing, and ask the user — do not
invent requirements.

**Gate 2 — Build.** With a READY spec, launch the `wai-builder` agent. It builds the page as
Astro components, reusing the v3 design, adding nothing beyond the spec. It must end with a
clean `npm run build`.

**Gate 3 — Design review (independent).** Launch the `wai-design-review` agent. It verifies the
page in the browser preview against the v3 design system and iterates with the Builder until it
returns `PASS`. This gate cannot be skipped.

**Gate 4 — Source-of-truth audit (independent, Codex).** Run the cross-model audit:
```
codex exec --full-auto "Read .codex/source-of-truth-audit.md and audit the $1 page. Output the verdict block."
```
If Codex is unavailable, tell the user the gate could not run and do **not** mark the page done —
this gate is non-collapsible.

**Human gate.** Summarise both verdicts plainly for Issam/Mervat and ask for approval. Only on a
yes: write the result back to the vault and run `/handoff` to log it. Report the page route and how
to preview it.
