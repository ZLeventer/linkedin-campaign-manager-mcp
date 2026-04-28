#!/usr/bin/env bash
# scan-changes.sh — shared scanner used by pre-commit and pre-push hooks.
#
# Behavior:
#   1. Reads .repo-class at repo root (PUBLIC-OSS / PRIVATE-WORK / etc).
#   2. Picks the right denylist (~/.config/git-denylists/strict.txt or loose.txt).
#   3. Runs gitleaks against the relevant diff.
#   4. Greps the diff against the denylist.
#   5. Hard-blocks if either finds anything.
#
# Bypass: `git commit --no-verify` / `git push --no-verify`
#   — but those are logged to ~/.config/git-denylists/override.log.
#
# Source of truth for this script: ZLeventer/linkedin-campaign-manager-mcp.
# Replicate updates to all repos using the rollout described in REPO-RULES.md.

set -euo pipefail

MODE="${1:-}"
case "$MODE" in
  --mode=pre-commit) MODE="pre-commit" ;;
  --mode=pre-push)   MODE="pre-push" ;;
  *) echo "scan-changes.sh: unknown mode '$MODE' (expected --mode=pre-commit or --mode=pre-push)" >&2; exit 2 ;;
esac

REPO_ROOT="$(git rev-parse --show-toplevel)"
CLASS_FILE="${REPO_ROOT}/.repo-class"
STRICT_LIST="${HOME}/.config/git-denylists/strict.txt"
LOOSE_LIST="${HOME}/.config/git-denylists/loose.txt"
OVERRIDE_LOG="${HOME}/.config/git-denylists/override.log"

# === Resolve repo class ===
if [[ ! -f "$CLASS_FILE" ]]; then
  echo "❌ scan-changes.sh: missing .repo-class at $REPO_ROOT" >&2
  echo "   Add one (PUBLIC-OSS, PRIVATE-WORK, PRIVATE-PERSONAL, UPSTREAM-FORK) or remove the hooks." >&2
  exit 1
fi
REPO_CLASS="$(tr -d '[:space:]' < "$CLASS_FILE")"

case "$REPO_CLASS" in
  PUBLIC-OSS|UPSTREAM-FORK) DENYLIST="$STRICT_LIST" ;;
  PRIVATE-WORK|PRIVATE-PERSONAL) DENYLIST="$LOOSE_LIST" ;;
  *) echo "❌ scan-changes.sh: unknown .repo-class value: '$REPO_CLASS'" >&2; exit 1 ;;
esac

if [[ ! -f "$DENYLIST" ]]; then
  echo "❌ scan-changes.sh: denylist not found: $DENYLIST" >&2
  echo "   Create it (see REPO-RULES.md)." >&2
  exit 1
fi

# === Compute diff to scan ===
if [[ "$MODE" == "pre-commit" ]]; then
  # Staged changes only
  DIFF_RANGE_DESC="staged changes"
  DIFF_OUTPUT="$(git diff --cached --no-color)"
  FILES_OUTPUT="$(git diff --cached --name-only)"
else
  # Pre-push: scan everything that would be pushed.
  # Uses upstream tracking branch if set, else falls back to origin/HEAD or main.
  UPSTREAM="$(git rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>/dev/null || true)"
  if [[ -z "$UPSTREAM" ]]; then
    UPSTREAM="$(git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed 's@^refs/remotes/@@' || echo origin/main)"
  fi
  DIFF_RANGE_DESC="${UPSTREAM}..HEAD"
  if git rev-parse --verify --quiet "$UPSTREAM" >/dev/null; then
    DIFF_OUTPUT="$(git diff "$UPSTREAM"..HEAD --no-color)"
    FILES_OUTPUT="$(git diff "$UPSTREAM"..HEAD --name-only)"
  else
    # First push of a branch — diff against empty tree
    DIFF_OUTPUT="$(git diff --no-color $(git hash-object -t tree /dev/null)..HEAD)"
    FILES_OUTPUT="$(git diff --name-only $(git hash-object -t tree /dev/null)..HEAD)"
  fi
fi

if [[ -z "$DIFF_OUTPUT" ]]; then
  echo "scan-changes.sh: no $DIFF_RANGE_DESC to scan, skipping."
  exit 0
fi

echo "scan-changes.sh: scanning $DIFF_RANGE_DESC against [$REPO_CLASS] rules…"

# === 1. Filename guard — block sensitive filenames regardless of class ===
SENSITIVE_FILES_REGEX='(^|/)(\.env(\..*)?|token\.json|credentials\.json|secrets\.json|.*\.pem|.*\.key|.*\.p12|service-account.*\.json)$'
BLOCKED_FILES=$(echo "$FILES_OUTPUT" | grep -E "$SENSITIVE_FILES_REGEX" || true)
if [[ -n "$BLOCKED_FILES" ]]; then
  echo "" >&2
  echo "❌ Sensitive filenames in diff:" >&2
  echo "$BLOCKED_FILES" | sed 's/^/   /' >&2
  echo "" >&2
  echo "   Add them to .gitignore and remove from the index. If this is intentional," >&2
  echo "   run with \`git commit --no-verify\` (logged) or \`git push --no-verify\`." >&2
  EXIT_CODE=1
fi

# === 2. gitleaks — secrets scan ===
# Uses gitleaks's `protect --staged` for pre-commit, `detect` over the range for pre-push.
if command -v gitleaks >/dev/null 2>&1; then
  set +e
  if [[ "$MODE" == "pre-commit" ]]; then
    GITLEAKS_OUT=$(gitleaks protect --staged --redact --no-banner 2>&1)
    GITLEAKS_RC=$?
  else
    GITLEAKS_OUT=$(gitleaks detect --redact --no-banner --log-opts="${UPSTREAM}..HEAD" 2>&1)
    GITLEAKS_RC=$?
  fi
  set -e
  if [[ $GITLEAKS_RC -ne 0 ]]; then
    echo "" >&2
    echo "❌ gitleaks found potential secrets:" >&2
    echo "$GITLEAKS_OUT" | sed 's/^/   /' >&2
    EXIT_CODE=1
  fi
else
  echo "⚠️  gitleaks not installed; skipping secrets scan. Install with: brew install gitleaks" >&2
fi

# === 3. Denylist scan — class-specific ===
# Only scan added/changed lines (lines starting with + but not ++).
ADDED_LINES=$(echo "$DIFF_OUTPUT" | grep -E '^\+[^+]' || true)
DENYLIST_HITS=""
if [[ -n "$ADDED_LINES" ]]; then
  # Read denylist (skip empty + comment lines), then case-insensitive fixed-string grep.
  PATTERNS=$(grep -v -E '^\s*(#|$)' "$DENYLIST" || true)
  if [[ -n "$PATTERNS" ]]; then
    DENYLIST_HITS=$(echo "$ADDED_LINES" | grep -i -F "$PATTERNS" || true)
  fi
fi
if [[ -n "$DENYLIST_HITS" ]]; then
  echo "" >&2
  echo "❌ Denylist match in $DIFF_RANGE_DESC ([$REPO_CLASS] uses ${DENYLIST}):" >&2
  echo "$DENYLIST_HITS" | head -20 | sed 's/^/   /' >&2
  HITS_COUNT=$(echo "$DENYLIST_HITS" | wc -l | tr -d ' ')
  if [[ "$HITS_COUNT" -gt 20 ]]; then
    echo "   …and $((HITS_COUNT - 20)) more matches" >&2
  fi
  echo "" >&2
  echo "   Genericize the content, or if this is a false positive update ${DENYLIST}." >&2
  EXIT_CODE=1
fi

# === Result ===
EXIT_CODE="${EXIT_CODE:-0}"
if [[ "$EXIT_CODE" -ne 0 ]]; then
  mkdir -p "$(dirname "$OVERRIDE_LOG")"
  echo "" >&2
  echo "   To override (logs to $OVERRIDE_LOG):" >&2
  if [[ "$MODE" == "pre-commit" ]]; then
    echo "     git commit --no-verify" >&2
  else
    echo "     git push --no-verify" >&2
  fi
  exit "$EXIT_CODE"
fi

echo "scan-changes.sh: ✅ no issues."
exit 0
