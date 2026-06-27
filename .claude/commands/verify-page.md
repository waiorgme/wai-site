---
description: Re-run the two independent gates (design review + Codex source-of-truth audit) on an already-built WAI-ME page, without rebuilding it.
argument-hint: <page>
---

Re-verify the **$1** page without rebuilding. Use this after a manual edit, or before launch.

1. Load the `wai-source-of-truth` skill.
2. **Design review:** launch `wai-design-review` for `$1`. Report PASS or the findings.
3. **Source-of-truth audit:** run
   `codex exec --full-auto "Read .codex/source-of-truth-audit.md and audit the $1 page. Output the verdict block."`
4. Summarise both verdicts plainly. If either fails, list the precise fixes and stop — do not
   call the page verified.
