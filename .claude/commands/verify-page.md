---
description: Re-run the two independent gates (design review + Codex source-of-truth audit) on an already-built WAI-ME page, without rebuilding it.
argument-hint: <page>
---

Re-verify the **$1** page without rebuilding. Use this after a manual edit, or before launch.

**Repo root.** The build repo is `/Users/ismac/Documents/Projects/wai-site`; this session may be
rooted in the vault, so use that absolute path for repo commands and tell the agent to use absolute paths.

1. Load the `wai-source-of-truth` skill.
2. **Design review:** launch `wai-design-review` for `$1`. Report PASS or the findings.
3. **Source-of-truth audit:** run `bash /Users/ismac/Documents/Projects/wai-site/scripts/codex-audit.sh $1` and read the verdict it writes to
   `/Users/ismac/Documents/Projects/wai-site/.codex/audits/$1.verdict.json` (exit 0 = PASS, 1 = FAIL, 2 = could not run). Do not copy/paste.
4. Summarise both verdicts plainly. If either fails, list the precise fixes and stop — do not
   call the page verified.
