#!/bin/bash
# Shared setup for agent-delegate scripts. Source it, do not run it.
# Reads per-project settings from <repo>/.delegate.json (all keys optional).

ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || { echo "Not inside a git repository." >&2; exit 1; }
CFG="$ROOT/.delegate.json"
REPO_NAME="$(cd "$(git rev-parse --git-common-dir)/.." && basename "$PWD")"
DELEGATE_HOME="$HOME/.cache/agent-delegate/$REPO_NAME"
WORKTREES="$DELEGATE_HOME/worktrees"
LOG_DIR="$DELEGATE_HOME/logs"

# cfg <dotted.key> [default] — prints a config value; arrays print one item per line.
cfg() {
  node -e '
    const fs = require("fs");
    const [file, key, fallback] = process.argv.slice(1);
    let conf = {};
    try { conf = JSON.parse(fs.readFileSync(file, "utf8")); } catch {}
    let v = key.split(".").reduce((o, k) => (o == null ? undefined : o[k]), conf);
    if (v === undefined) v = fallback === undefined ? "" : fallback;
    process.stdout.write(Array.isArray(v) ? v.join("\n") : typeof v === "object" ? JSON.stringify(v) : String(v));
  ' "$CFG" "$1" "${2-}"
}

DEFAULT_AGY_ALLOW='command(ls)
command(cat)
command(head)
command(tail)
command(grep)
command(rg)
command(find)
command(wc)
command(sort)
command(uniq)
command(cut)
command(tr)
command(du)
command(stat)
command(pwd)
command(git status)
command(git diff)
command(git log)'

BUILD_CMD="$(cfg build "")"
TEST_CMD="$(cfg test "")"
LOG_FILE="$ROOT/$(cfg log ".delegate/log.jsonl")"
LINK_DIRS="$(cfg linkDirs "node_modules")"
RISKY_PATHS="$(cfg risky "")"
PROTECTED_PATHS="$(cfg protected "")"
EXTRA_RULES="$(cfg rules "")"
AGY_MODEL="$(cfg agy.model "gemini-3.8-flash-high")"
AGY_TIMEOUT="$(cfg agy.timeout "30m")"
CODEX_MODEL="$(cfg codex.model "gpt-5.6-luna")"
CODEX_BASE_URL="$(cfg codex.baseUrl "https://chatgpt.com/backend-api/codex")"
REVIEW_MAX_LINES="$(cfg reviewMaxLines "400")"

agy_allow_list() {
  local extra
  extra="$(cfg agy.allow "")"
  {
    printf '%s\n' "$DEFAULT_AGY_ALLOW"
    if [ -n "$BUILD_CMD" ]; then echo "command($BUILD_CMD)"; fi
    if [ -n "$TEST_CMD" ]; then echo "command($TEST_CMD)"; fi
    if [ -n "$extra" ]; then printf '%s\n' "$extra"; fi
  } | awk 'NF && !seen[$0]++'
}

agy_settings_json() {
  agy_allow_list | node -e 'const l=require("fs").readFileSync(0,"utf8").split("\n").filter(Boolean);
    process.stdout.write(JSON.stringify({permissions:{allow:l}}))'
}

# Human-readable list for the prompt, e.g. "ls, cat, npm run build".
agy_allowed_commands_text() {
  agy_allow_list | sed -n 's/^command(\(.*\))$/\1/p' | paste -sd ',' - | sed 's/,/, /g'
}

log_json() { # log_json key value key value ...
  mkdir -p "$(dirname "$LOG_FILE")"
  node -e '
    const a = process.argv.slice(1); const o = { date: new Date().toISOString().slice(0, 10), ts: Date.now() };
    for (let i = 0; i < a.length; i += 2) o[a[i]] = /^\d+$/.test(a[i + 1]) ? Number(a[i + 1]) : a[i + 1];
    process.stdout.write(JSON.stringify(o) + "\n");
  ' "$@" >>"$LOG_FILE"
}
