#!/bin/bash
# Check that delegation can work in this repo: tools installed, logged in, config present.
# Usage: doctor.sh
set -uo pipefail
ok() { echo "ok    $1"; }
bad() { echo "FIX   $1"; }

command -v git >/dev/null && ok "git" || bad "git missing"
command -v node >/dev/null && ok "node (used to read .delegate.json)" || bad "node missing: brew install node"

if command -v agy >/dev/null; then ok "agy $(agy --version 2>/dev/null | head -1)"
else bad "agy missing: see https://antigravity.google (CLI installer), then run agy once to sign in"; fi

if command -v codex >/dev/null; then
  if codex login status 2>&1 | grep -qi "logged in"; then ok "codex logged in"
  else bad "codex not logged in: run 'codex login'"; fi
else bad "codex missing: npm i -g @openai/codex"; fi

if git rev-parse --show-toplevel >/dev/null 2>&1; then
  source "$(dirname "$0")/common.sh"
  if [ -f "$CFG" ]; then ok ".delegate.json found"; else bad "no .delegate.json: run /delegate-init"; fi
  [ -n "$BUILD_CMD" ] && ok "build: $BUILD_CMD" || echo "note  no build command set"
  [ -n "$TEST_CMD" ] && ok "test: $TEST_CMD" || echo "note  no test command set"
  echo "note  worktrees: $WORKTREES"
  echo "note  log: $LOG_FILE"
else
  bad "not inside a git repository"
fi
