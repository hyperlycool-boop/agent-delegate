---
description: Accept, reject or escalate a delegated task
argument-hint: "<slug> <accept|reject|escalate> [note]"
---

Run `${CLAUDE_PLUGIN_ROOT}/scripts/finish.sh $ARGUMENTS` and report the result in one or two lines. If the verdict is escalate, continue the task at the next tier per the agent-delegate skill.
