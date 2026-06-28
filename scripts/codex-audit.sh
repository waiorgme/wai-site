#!/usr/bin/env bash
# Gate 4 bridge: run Codex's independent source-of-truth audit non-interactively
# and capture a machine-readable verdict. Called by /build-page and /verify-page.
#
# Usage:  scripts/codex-audit.sh <page>
# Output: writes .codex/audits/<page>.verdict.json, prints it to stdout.
# Exit:   0 = PASS, 1 = FAIL, 2 = audit could not run.
set -euo pipefail

PAGE="${1:?usage: codex-audit.sh <page>}"
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VAULT="/Users/ismac/Documents/Projects/WAI"
AUDIT_DIR="$REPO/.codex/audits"
VERDICT_FILE="$AUDIT_DIR/$PAGE.verdict.json"
LOG_FILE="$AUDIT_DIR/$PAGE.log"
mkdir -p "$AUDIT_DIR"

if ! command -v codex >/dev/null 2>&1; then
  echo "ERROR: codex CLI not found on PATH. Gate 4 is non-collapsible; cannot mark the page done." >&2
  exit 2
fi

read -r -d '' PROMPT <<EOF || true
You are running Gate 4, the independent source-of-truth audit, for the WAI-ME website.
Follow .codex/source-of-truth-audit.md in this repo exactly, for the page named: $PAGE

The vault is the single source of truth and lives at: $VAULT
Use SOURCE-MAP.md to find this page's route and its governing vault notes.
Audit the BUILT page: prefer the compiled HTML in dist/ for this route (for the 'home' page that is dist/index.html), and fall back to the Astro source under src/ if dist/ is absent.

Check that every fact, number, name, date, place, and tier traces to a vault note; that copy is verbatim; that the brand locks hold (real logo asset only, gold = recognition only, no em-dashes, concept images marked); and that Decisions are honoured. Any sentence with no vault source is a FAIL.

This is a STAGING site. Read STAGING-CHECKLIST.md in the repo root and apply its staging-allowance rule (also restated in .codex/source-of-truth-audit.md): a claim with no vault source is allowed - recorded under staging_allowances, not orphan_claims, and does NOT force FAIL - ONLY when it is both visibly marked as placeholder/test data on the page AND listed for this page in STAGING-CHECKLIST.md. If only one is true, it is still a FAIL. The staging allowance never relaxes the brand locks and never excuses reworded or invented versions of copy the vault does have.

Return ONLY the final verdict as JSON matching the provided schema. Do not write or modify any files; you are read-only and the orchestrator records the result and the handoff entry.
EOF

# Run the audit. Read-only sandbox: Codex can read the repo and the sibling vault, but writes nothing.
if ! codex exec \
      --cd "$REPO" \
      --sandbox read-only \
      --output-schema "$REPO/.codex/verdict.schema.json" \
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

# Print the verdict and set the exit code from its verdict field.
node -e '
const fs = require("fs");
let v;
try { v = JSON.parse(fs.readFileSync(process.argv[1], "utf8")); }
catch (e) { console.error("ERROR: verdict file is not valid JSON:", e.message); process.exit(2); }
console.log(JSON.stringify(v, null, 2));
process.exit(v.verdict === "PASS" ? 0 : 1);
' "$VERDICT_FILE"
