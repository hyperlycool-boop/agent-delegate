#!/bin/bash
# Run one delegated task with agy or codex in an isolated git worktree.
# Usage: run.sh <agy|codex> <slug> <brief-file>
# Agents run sandboxed and may edit only the worktree. This script runs the
# project's build and test commands itself and prints a short report.
set -euo pipefail
source "$(dirname "$0")/common.sh"

AGENT="${1:-}"; SLUG="${2:-}"; BRIEF="${3:-}"
if [ -z "$AGENT" ] || [ -z "$SLUG" ] || [ ! -f "$BRIEF" ]; then
  echo "Usage: run.sh <agy|codex> <slug> <brief-file>" >&2; exit 1
fi
case "$SLUG" in *[!a-z0-9-]*) echo "Slug must be lowercase letters, digits and dashes." >&2; exit 1 ;; esac

WT="$WORKTREES/$SLUG"
LOG="$LOG_DIR/$SLUG.$AGENT.log"
LAST="$LOG_DIR/$SLUG.$AGENT.last.md"
mkdir -p "$LOG_DIR" "$WORKTREES"
BRIEF_ABS="$(cd "$(dirname "$BRIEF")" && pwd)/$(basename "$BRIEF")"

if [ ! -d "$WT" ]; then
  git -C "$ROOT" worktree add -q -b "delegate/$SLUG" "$WT" HEAD
  # Copy the orchestrator's uncommitted work so the delegate sees it too.
  git -C "$ROOT" diff HEAD --binary | git -C "$WT" apply --allow-empty 2>/dev/null || true
  (cd "$ROOT" && git ls-files --others --exclude-standard | while read -r f; do
    mkdir -p "$WT/$(dirname "$f")" && cp "$f" "$WT/$f"; done)
  while read -r d; do
    if [ -n "$d" ] && [ -e "$ROOT/$d" ] && [ ! -e "$WT/$d" ]; then ln -s "$ROOT/$d" "$WT/$d"; fi
  done <<<"$LINK_DIRS"
  # Keep linked dirs out of the delegate's diff.
  EXCLUDE_FILE="$(cd "$WT" && git rev-parse --path-format=absolute --git-path info/exclude)"
  mkdir -p "$(dirname "$EXCLUDE_FILE")"
  while read -r d; do if [ -n "$d" ]; then echo "/$d" >>"$EXCLUDE_FILE"; fi; done <<<"$LINK_DIRS"
  git -C "$WT" add -A >/dev/null
  git -C "$WT" -c user.name=delegate -c user.email=delegate@local commit -q -m "baseline" --allow-empty
fi

PROMPT="You are a delegated worker in an isolated git worktree of this project.
Read AGENTS.md, CLAUDE.md or GEMINI.md first if they exist, and follow them.
Only edit files inside this folder. Never commit, push, or install dependencies."
[ -n "$PROTECTED_PATHS" ] && PROMPT="$PROMPT
Never edit these paths: $(echo "$PROTECTED_PATHS" | tr '\n' ' ')"
[ -n "$EXTRA_RULES" ] && PROMPT="$PROMPT
$EXTRA_RULES"
[ "$AGENT" = "agy" ] && PROMPT="$PROMPT
Shell access is limited. The only shell commands allowed are: $(agy_allowed_commands_text).
Do not use pipes into other programs, xargs, sed, awk, or scripts. Prefer your built-in file read, search and write tools; count lines by reading files if needed."
PROMPT="$PROMPT
When done, reply in at most 10 lines: what you changed, and anything you are unsure about.

TASK BRIEF:
$(cat "$BRIEF_ABS")"

START=$(date +%s)
log_json event start slug "$SLUG" agent "$AGENT"
set +e
if [ "$AGENT" = "agy" ]; then
  (cd "$WT" && agy -p "$PROMPT" --model "$AGY_MODEL" --mode accept-edits --sandbox \
    --settings "$(agy_settings_json)" --print-timeout "$AGY_TIMEOUT" >"$LAST" 2>"$LOG")
elif [ "$AGENT" = "codex" ]; then
  codex exec -C "$WT" -s workspace-write --skip-git-repo-check \
    -c "openai_base_url=\"$CODEX_BASE_URL\"" -m "$CODEX_MODEL" \
    -o "$LAST" "$PROMPT" >"$LOG" 2>&1
else
  echo "Unknown agent: $AGENT (use agy or codex)" >&2; exit 1
fi
AGENT_EXIT=$?
set -e
# An empty reply means the agent did not really run (e.g. a denied permission).
[ "$AGENT_EXIT" -eq 0 ] && [ ! -s "$LAST" ] && AGENT_EXIT=99
SECONDS_TAKEN=$(( $(date +%s) - START ))

check() {
  [ -z "$1" ] && { echo "SKIP"; return; }
  if (cd "$WT" && bash -c "$1" >>"$LOG" 2>&1); then echo "PASS"; else echo "FAIL"; fi
}
BUILD=$(check "$BUILD_CMD")
TESTS=$(check "$TEST_CMD")

git -C "$WT" add -A >/dev/null
FILES=$(git -C "$WT" diff --cached --name-only HEAD | wc -l | tr -d ' ')
TOUCHED_PROTECTED=""
while read -r p; do
  if [ -n "$p" ] && git -C "$WT" diff --cached --name-only HEAD -- "$p" | grep -q .; then
    TOUCHED_PROTECTED="$TOUCHED_PROTECTED $p"
  fi
done <<<"$PROTECTED_PATHS"

echo "== delegate $SLUG ($AGENT): ${SECONDS_TAKEN}s, agent exit $AGENT_EXIT"
echo "== build $BUILD · tests $TESTS · files changed $FILES"
[ -n "$TOUCHED_PROTECTED" ] && echo "== WARNING: protected paths changed:$TOUCHED_PROTECTED"
git -C "$WT" diff --cached --stat HEAD | tail -15
echo "== agent says:"
head -c 1500 "$LAST" 2>/dev/null || echo "(no reply)"
echo
if [ "$BUILD" = "FAIL" ] || [ "$TESTS" = "FAIL" ] || [ "$AGENT_EXIT" -ne 0 ]; then
  echo "== first errors:"
  grep -m 8 -iE "error|fail|denied" "$LOG" || true
fi
echo "== full log: $LOG"

log_json slug "$SLUG" agent "$AGENT" seconds "$SECONDS_TAKEN" agent_exit "$AGENT_EXIT" \
  build "$BUILD" tests "$TESTS" files "$FILES" verdict pending
