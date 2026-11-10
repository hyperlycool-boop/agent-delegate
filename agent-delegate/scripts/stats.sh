#!/bin/bash
# Summarize the delegation log: runs, verdicts and average time per agent.
# Usage: stats.sh
set -euo pipefail
source "$(dirname "$0")/common.sh"

[ -f "$LOG_FILE" ] || { echo "No log yet at $LOG_FILE"; exit 0; }
node -e '
  const lines = require("fs").readFileSync(process.argv[1], "utf8").split("\n").filter(Boolean).map(JSON.parse);
  const lastAgent = {}; const s = {};
  const get = (a) => (s[a] ??= { runs: 0, secs: 0, failedChecks: 0, accept: 0, reject: 0, escalate: 0 });
  for (const e of lines) {
    if (e.event === "start") continue;
    if (e.agent) {
      lastAgent[e.slug] = e.agent; const r = get(e.agent);
      r.runs++; r.secs += e.seconds || 0;
      if (e.build === "FAIL" || e.tests === "FAIL" || e.agent_exit) r.failedChecks++;
    } else if (e.verdict && lastAgent[e.slug]) get(lastAgent[e.slug])[e.verdict]++;
  }
  console.log("agent  runs  avg_s  failed  accept  reject  escalate");
  for (const [a, r] of Object.entries(s))
    console.log([a.padEnd(6), String(r.runs).padStart(4), String(Math.round(r.secs / r.runs)).padStart(6),
      String(r.failedChecks).padStart(7), String(r.accept).padStart(7), String(r.reject).padStart(7),
      String(r.escalate).padStart(9)].join(" "));
' "$LOG_FILE"
echo "log: $LOG_FILE"
