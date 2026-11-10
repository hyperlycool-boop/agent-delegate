---
name: agent-delegate
description: Route work from Claude to cheaper agents — Antigravity (agy, Gemini) and OpenAI Codex — each in an isolated git worktree, then verify, review, and accept, reject or escalate. Use when the user says "delegate", "hand this to codex / gemini / antigravity / agy", "save tokens", "use the cheaper model", or runs /delegate. ALWAYS use it, without asking the user, before starting any task in a repo that has a .delegate.json (or whose CLAUDE.md asks for delegation): its presence means delegation is pre-authorized there.
---

# agent-delegate

Claude (the main session, ideally Opus) is the **orchestrator**: it plans, reasons, and reviews. Cheaper agents do the volume work. Quality beats savings: weak work escalates at once.

Scripts live in `${CLAUDE_PLUGIN_ROOT}/scripts/`. Run them from inside the target repo.

**Auto mode.** A `.delegate.json` in the repo is the user's standing yes: route every task with the table below and delegate without asking. Tell the user in one line what you delegated and to whom. Pre-authorization covers running delegates only; it never covers committing, pushing or adding dependencies.

## 1. Route the task

| Task | First choice | Fallback |
|---|---|---|
| Hard reasoning: architecture, root-cause debugging, correctness of math/logic, planning, reviewing delegated diffs | Claude itself | — |
| Token-heavy: read/summarize many files, whole-repo audits, bulk docs, refactors across many files, long loops | **agy** | codex → Sonnet subagent |
| Small/medium code edits and tests from a clear plan | **codex** | agy → Sonnet subagent |
| Menial: renames, formatting, boilerplate, lint fixes, link checks | agy or codex | Haiku subagent (`model: "haiku"`) |

- **Do it yourself** if the task would cost you under ~2k tokens; a brief plus review costs more.
- Project rules (CLAUDE.md / AGENTS.md / `.delegate.json` `protected`) still apply. Content the project marks as correctness-critical may be drafted by a delegate, but you re-verify every fact, formula and answer before keeping it.
- Delegates never commit, push, or add dependencies. You commit, after review.

## 2. Workflow

1. **Check once per session:** `${CLAUDE_PLUGIN_ROOT}/scripts/doctor.sh`. No `.delegate.json` → run `/delegate-init` (or copy `templates/delegate.json`) and fill in the project's build/test commands.
2. **Brief:** write ~200 tokens using `${CLAUDE_PLUGIN_ROOT}/templates/brief.md` (GOAL, FILES, DONE WHEN, DO NOT TOUCH, NOTES) to `~/.cache/agent-delegate/<repo>/briefs/<slug>.md`. The delegate reads AGENTS.md/CLAUDE.md itself; do not repeat project rules. Slug: lowercase-with-dashes.
3. **Run:** `${CLAUDE_PLUGIN_ROOT}/scripts/run.sh <agy|codex> <slug> <brief-file> [--model <name>] [--effort <level>]`. Model and effort come from, in order: the flags, `~/.cache/agent-delegate/<repo>/overrides.json` (set by the user in the Delegation pane), `.delegate.json` (`agy.model`, `agy.effort`, `codex.model`, `codex.effort`), the agent default. Pass the flags only when the user asks for a specific model or effort. Run it in the background for long jobs; independent jobs on different files may run in parallel. It prints only: time, build/tests PASS/FAIL, diff stat, the agent's ≤10-line reply, first errors. Do not open the full log unless something failed.
4. **Review:** `${CLAUDE_PLUGIN_ROOT}/scripts/review.sh <slug>`. Risky paths are shown in full; read them carefully. Spot-check any factual claim in the agent's reply against the repo.
5. **Decide:** `${CLAUDE_PLUGIN_ROOT}/scripts/finish.sh <slug> <accept|reject|escalate> "<note>"`.
   - `accept` applies the diff to the current checkout, uncommitted.
   - `escalate` keeps the worktree so the next tier can continue from it.
6. Commit following the project's own workflow.

## 3. Escalation (quality first)

- Stuck, looping, wrong, weak, failed checks, or changed a protected path → **escalate now**, no third try.
- Path: agy/codex → the other one (only if the failure looks agent-specific) → Sonnet subagent → you (Opus).
- Skip straight to yourself for hard problems: design flaw, unclear root cause, correctness of math, logic or domain content.
- Hand the next tier the failure notes and the kept worktree path so no work is lost.
- An empty reply (`agent exit 99`) is an infrastructure problem (usually a denied permission), not a delegate failure: fix it and rerun once.

## 4. Measure

`${CLAUDE_PLUGIN_ROOT}/scripts/stats.sh` shows runs, failures and verdicts per agent from the log. Use it to adjust routing per project.

## Known quirks
- Headless agy cannot prompt for permissions. `run.sh` passes a read-only allow-list plus the build/test commands via `--settings`. Add more in `.delegate.json` → `agy.allow` only when a task truly needs them. Never use `--dangerously-skip-permissions`.
- Codex's sandbox cannot write into linked `node_modules`, so its own test runs may fail with `EPERM`. Ignore that; `run.sh` runs the checks outside the sandbox.
- `codex.baseUrl` defaults to the ChatGPT backend so a ChatGPT login works even if `~/.codex/config.toml` points elsewhere. Model names: `~/.codex/models_cache.json`; agy models: `agy models`.
