#!/usr/bin/env bash
# Gate 4 bridge for PORTAL/BACKEND slices: run Codex's independent code review
# non-interactively and capture a machine-readable verdict. The sibling
# codex-audit.sh stays the Gate 4 for public PAGES (source-of-truth audit);
# this one is the builder-is-not-reviewer gate for code slices, per the vault
# note [[02 Build Method - AI-Assisted Delivery (Playbook)]].
#
# Usage:  scripts/codex-review.sh <slice-name>
#         (reviews the diff of the CURRENT branch against main, plus the spec
#          at specs/<slice-name>.spec.md when present)
# Output: writes .codex/audits/<slice-name>.review.json, prints it to stdout.
# Exit:   0 = SHIP, 1 = DO-NOT-SHIP, 2 = review could not run.
set -euo pipefail

SLICE="${1:?usage: codex-review.sh <slice-name>}"
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VAULT="/Users/ismac/Documents/Projects/WAI"
AUDIT_DIR="$REPO/.codex/audits"
VERDICT_FILE="$AUDIT_DIR/$SLICE.review.json"
LOG_FILE="$AUDIT_DIR/$SLICE.review.log"
mkdir -p "$AUDIT_DIR"

if ! command -v codex >/dev/null 2>&1; then
  echo "ERROR: codex CLI not found on PATH. Gate 4 is non-collapsible; cannot mark the slice done." >&2
  exit 2
fi

BRANCH="$(git -C "$REPO" rev-parse --abbrev-ref HEAD)"

read -r -d '' PROMPT <<EOF || true
You are running Gate 4, the independent cross-model CODE REVIEW, for a WAI-ME
member-portal slice named: $SLICE (branch: $BRANCH).

You are the reviewer; a different model built this. Be adversarial. Your job is
to find real ship-blockers, especially: authorization gaps, safeguarding holes
around minors, input-validation bypasses, secrets, data leakage, broken audit
trails, and claims in the spec that the code does not actually deliver.

Review the full diff against main:  git diff main...HEAD
Spec (acceptance criteria):         specs/$SLICE.spec.md (if present)
The vault (single source of truth): $VAULT
Relevant vault notes: the Stage 0 technical design, the under-18 safeguards
decision, and the audit findings register under 02 Platform/.

Also verify member-facing strings added by the diff honour the brand locks
(no em dashes, plain language) and that every spec acceptance criterion is
actually met by code, not by comments.

Return ONLY the final verdict as JSON matching the provided schema
(SHIP / DO-NOT-SHIP with evidence). Do not write or modify any files; you are
read-only and the orchestrator records the result and the handoff entry.
EOF

if ! codex exec \
      --cd "$REPO" \
      --sandbox read-only \
      --output-schema "$REPO/.codex/code-review.schema.json" \
      -o "$VERDICT_FILE" \
      "$PROMPT" >"$LOG_FILE" 2>&1; then
  echo "ERROR: codex exec failed. See $LOG_FILE" >&2
  tail -20 "$LOG_FILE" >&2 || true
  exit 2
fi

if [ ! -s "$VERDICT_FILE" ]; then
  echo "ERROR: no verdict captured at $VERDICT_FILE. See $LOG_FILE" >&2
  exit 2
fi

node -e '
const fs = require("fs");
let v;
try { v = JSON.parse(fs.readFileSync(process.argv[1], "utf8")); }
catch (e) { console.error("ERROR: verdict file is not valid JSON:", e.message); process.exit(2); }
console.log(JSON.stringify(v, null, 2));
process.exit(v.verdict === "SHIP" ? 0 : 1);
' "$VERDICT_FILE"
