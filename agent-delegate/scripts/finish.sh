#!/bin/bash
# Close a delegated task: apply its changes, throw them away, or keep them for the next tier.
# Usage: finish.sh <slug> <accept|reject|escalate> [note]
set -euo pipefail
source "$(dirname "$0")/common.sh"

SLUG="${1:-}"; VERDICT="${2:-}"; NOTE="${3:-}"
case "$VERDICT" in accept|reject|escalate) ;; *)
  echo "Usage: finish.sh <slug> <accept|reject|escalate> [note]" >&2; exit 1 ;;
esac
WT="$WORKTREES/$SLUG"
[ -d "$WT" ] || { echo "No worktree for $SLUG" >&2; exit 1; }

if [ "$VERDICT" = "accept" ]; then
  git -C "$WT" add -A >/dev/null
  if git -C "$WT" diff --cached --quiet HEAD; then
    echo "Nothing to apply for $SLUG."
  else
    git -C "$WT" diff --cached --binary HEAD | git -C "$ROOT" apply --3way --whitespace=nowarn
    echo "Applied $SLUG to $ROOT (not committed)."
  fi
fi

log_json slug "$SLUG" verdict "$VERDICT" note "$NOTE"

if [ "$VERDICT" = "escalate" ]; then
  echo "Worktree kept for the next tier: $WT"
  exit 0
fi
git -C "$ROOT" worktree remove --force "$WT"
git -C "$ROOT" branch -D "delegate/$SLUG" >/dev/null
echo "Removed worktree and branch delegate/$SLUG."
