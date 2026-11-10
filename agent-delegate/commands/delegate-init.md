---
description: Create .delegate.json for this repo
---

Create `.delegate.json` in the repo root from `${CLAUDE_PLUGIN_ROOT}/templates/delegate.json`. Fill it from the project itself: real build and test commands (package.json scripts, Makefile, etc.), `risky` = paths where a wrong change is costly (core logic, data, tests, dependency manifests), `protected` = files delegates must never edit (named in CLAUDE.md/AGENTS.md as source of truth), `rules` = one or two project-specific rules from CLAUDE.md. Remove keys that do not apply. Show the file, then run `${CLAUDE_PLUGIN_ROOT}/scripts/doctor.sh`.
