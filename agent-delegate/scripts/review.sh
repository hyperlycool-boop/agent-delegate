#!/bin/bash
# Show a delegated task's diff in the cheapest useful form.
# Risky paths (from .delegate.json "risky") are always shown in full. Other
# changes are shown in full when small, or summarized by agy when large.
# Usage: review.sh <slug>
set -euo pipefail
source "$(dirname "$0")/common.sh"

SLUG="${1:-}"
[ -n "$SLUG" ] || { echo "Usage: review.sh <slug>" >&2; exit 1; }
WT="$WORKTREES/$SLUG"
[ -d "$WT" ] || { echo "No worktree for $SLUG" >&2; exit 1; }

git -C "$WT" add -A >/dev/null
echo "== stat"
git -C "$WT" diff --cached --stat HEAD

EXCLUDES=()
if [ -n "$RISKY_PATHS" ]; then
  echo "== risky paths (always full)"
  RISKY_ARR=()
  while read -r p; do [ -n "$p" ] && RISKY_ARR+=("$p") && EXCLUDES+=(":(exclude)$p"); done <<<"$RISKY_PATHS"
  git -C "$WT" diff --cached HEAD -- "${RISKY_ARR[@]}"
fi

REST=$(git -C "$WT" diff --cached HEAD -- . ${EXCLUDES[@]+"${EXCLUDES[@]}"})
LINES=$(printf '%s' "$REST" | wc -l | tr -d ' ')
echo "== other changes ($LINES diff lines)"
if [ "$LINES" -le "$REVIEW_MAX_LINES" ]; then
  printf '%s\n' "$REST"
else
  printf '%s' "$REST" | agy -p "Summarize this git diff for a code reviewer in at most 25 lines. List each file, what changed, and anything that looks wrong, risky, or overly complex. The diff is on stdin." \
    --model "$AGY_MODEL" --print-timeout 10m
fi
