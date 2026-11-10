# agent-delegate

Claude Code plugins that hand cheap and token-heavy work to other coding agents, so Claude keeps its quota for hard reasoning.

- **agent-delegate**: a skill, six slash commands and scripts. Each job runs in its own git worktree with Antigravity (`agy`) or Codex (`codex`). The scripts run your build and tests, show a short report, and let Claude accept, reject or escalate the result.
- **delegate-panel**: a mod. A live pane lists delegation jobs (running or finished, agent, time, build and test results, verdict) with per-agent stats. In any repo with a `.delegate.json` it also tells Claude to delegate without asking.

## Install

At the prompt of a terminal session:

```
/plugin install agent-delegate --marketplace hyperlycool-boop/agent-delegate
/plugin install delegate-panel --marketplace hyperlycool-boop/agent-delegate
```

From a shell:

```
claude plugin install agent-delegate --marketplace hyperlycool-boop/agent-delegate
claude plugin install delegate-panel --marketplace hyperlycool-boop/agent-delegate
```

In the desktop app, where `/plugin` does not run: click + next to the prompt box, then Plugins, Add marketplace with `hyperlycool-boop/agent-delegate`, then Add plugin.

The repository is private. Installing needs GitHub access to it and a git credential for github.com on your machine (an SSH key, or `gh auth login` then `gh auth setup-git`).

## Requirements

- `git` and `node`.
- `agy` (Antigravity CLI), signed in.
- `codex` (`npm i -g @openai/codex`), signed in.
- Run `/agent-delegate:delegate-doctor` to check.

## Use

1. In your repo, run `/agent-delegate:delegate-init` to create `.delegate.json` (build and test commands, risky and protected paths).
2. Run `/agent-delegate:delegate <task>`, or just work: with a `.delegate.json` present, Claude routes tasks on its own.
3. Review with `/agent-delegate:delegate-review <slug>`, then `/agent-delegate:delegate-finish <slug> accept|reject|escalate`.
4. `/delegate-panel` opens the live pane. `/agent-delegate:delegate-stats` prints the stats.

Delegates never commit, push or add dependencies. Claude reviews every diff and does the hard reasoning itself.
