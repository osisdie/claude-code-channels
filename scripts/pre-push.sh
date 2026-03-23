#!/usr/bin/env bash
# Git pre-push hook — blocks push on lint, security, or commit message failures.
# Install: ln -sf ../../scripts/pre-push.sh .git/hooks/pre-push
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

MAIN=$(git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed 's@refs/remotes/origin/@@' || echo main)
FAIL=0
WARN=0

pass()  { echo "  [PASS] $1"; }
fail()  { echo "  [FAIL] $1"; FAIL=$((FAIL+1)); }
warn()  { echo "  [WARN] $1"; WARN=$((WARN+1)); }

echo "========================================"
echo "  PRE-PUSH REVIEW"
echo "========================================"

# ── 1. Markdown lint ────────────────────────────────────────
echo ""
echo "1. Markdown lint"
if command -v bunx &>/dev/null; then
  if bunx markdownlint-cli2 "**/*.md" 2>&1; then
    pass "markdownlint-cli2"
  else
    fail "markdownlint-cli2 found errors"
  fi
elif command -v markdownlint-cli2 &>/dev/null; then
  if markdownlint-cli2 "**/*.md" 2>&1; then
    pass "markdownlint-cli2"
  else
    fail "markdownlint-cli2 found errors"
  fi
else
  warn "markdownlint-cli2 not found — skipping"
fi

# ── 2. ShellCheck ───────────────────────────────────────────
echo ""
echo "2. ShellCheck"
if command -v shellcheck &>/dev/null; then
  if find . -name "*.sh" -not -path "*/node_modules/*" -exec shellcheck -S warning {} + 2>&1; then
    pass "shellcheck"
  else
    fail "shellcheck found warnings"
  fi
else
  warn "shellcheck not found — skipping"
fi

# ── 3. Security — no secrets in diff ────────────────────────
echo ""
echo "3. Security scan"
DIFF=$(git diff "$MAIN"...HEAD -- . ':!*.lock' ':!node_modules' ':!.wrangler' ':!.venv' ':!scripts/pre-push.sh' ':!lib/safety/filter.ts' ':!docs/broker/safety.md' ':!docs/plugins/architecture*' 2>/dev/null || true)
FOUND=0
while IFS= read -r pattern; do
  if echo "$DIFF" | grep -qE "$pattern"; then
    # Exclude documentation examples and env var references
    REAL=$(echo "$DIFF" | grep -E "$pattern" | grep -v 'example\|placeholder\|your-\|process\.env\|xoxb-your\|<YOUR_\|sk-\.\.\.\|generate-with')
    if [[ -n "$REAL" ]]; then
      echo "    Found: $pattern"
      FOUND=$((FOUND+1))
    fi
  fi
done <<'PATTERNS'
sk-[a-zA-Z0-9]{20,}
xoxb-[0-9]+-[a-zA-Z0-9]+
ghp_[a-zA-Z0-9]{36,}
glpat-[a-zA-Z0-9-]{20,}
AIza[a-zA-Z0-9_-]{35,}
BEGIN.*PRIVATE KEY
PATTERNS
if [[ $FOUND -gt 0 ]]; then
  fail "potential secrets found in diff ($FOUND pattern(s))"
else
  pass "no secrets in diff"
fi

# ── 4. Conventional commits ─────────────────────────────────
echo ""
echo "4. Conventional commits"
COMMITS=$(git log "$MAIN"..HEAD --format="%s" 2>/dev/null || true)
BAD=0
if [[ -n "$COMMITS" ]]; then
  while IFS= read -r msg; do
    # Check conventional commit format
    if ! echo "$msg" | grep -qE '^(feat|fix|refactor|docs|style|test|ci|chore|perf|build|revert)(\(.+\))?!?:'; then
      # Allow merge commits
      if ! echo "$msg" | grep -qE '^Merge '; then
        echo "    Bad: $msg"
        BAD=$((BAD+1))
      fi
    fi
  done <<< "$COMMITS"
fi
if [[ $BAD -gt 0 ]]; then
  fail "non-conventional commit messages ($BAD)"
else
  pass "all commits follow conventional format"
fi

# ── 5. CHANGELOG freshness ─────────────────────────────────
echo ""
echo "5. CHANGELOG"
if [[ -f CHANGELOG.md ]]; then
  LATEST_DATE=$(grep -oP '\d{4}-\d{2}-\d{2}' CHANGELOG.md | head -1)
  if [[ -n "$LATEST_DATE" ]]; then
    DAYS_AGO=$(( ($(date +%s) - $(date -d "$LATEST_DATE" +%s 2>/dev/null || echo 0)) / 86400 ))
    if [[ $DAYS_AGO -gt 30 ]]; then
      fail "CHANGELOG last updated $DAYS_AGO days ago"
    elif [[ $DAYS_AGO -gt 7 ]]; then
      warn "CHANGELOG last updated $DAYS_AGO days ago"
    else
      pass "CHANGELOG up to date ($LATEST_DATE)"
    fi
  else
    warn "no date found in CHANGELOG.md"
  fi
else
  warn "CHANGELOG.md not found"
fi

# ── Summary ─────────────────────────────────────────────────
echo ""
echo "========================================"
echo "  RESULT: $FAIL failed, $WARN warnings"
echo "========================================"

if [[ $FAIL -gt 0 ]]; then
  echo ""
  echo "  Push blocked. Fix the issues above and try again."
  exit 1
fi
