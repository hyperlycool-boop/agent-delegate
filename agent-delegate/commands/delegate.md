---
description: Delegate a task to agy or codex in an isolated worktree, then review it
argument-hint: "[agy|codex] <task description>"
---

Delegate this task using the agent-delegate skill: $ARGUMENTS

1. If the first word is `agy` or `codex`, use that agent; otherwise pick one with the routing table in the skill. If the task is under ~2k tokens of work, say so and do it yourself instead.
2. Pick a short slug, write the brief from `${CLAUDE_PLUGIN_ROOT}/templates/brief.md` to `~/.cache/agent-delegate/<repo>/briefs/<slug>.md`.
3. Run `${CLAUDE_PLUGIN_ROOT}/scripts/run.sh <agent> <slug> <brief>` (background if it may take long).
4. Review with `${CLAUDE_PLUGIN_ROOT}/scripts/review.sh <slug>`, spot-check claims, then `finish.sh` with accept, reject or escalate, following the escalation rules.
5. Report in a few lines: agent, time, checks, verdict, what changed. Do not commit.
