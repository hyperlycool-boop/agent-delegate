import { atom, read } from 'claude-code'
import type { Register } from 'claude-code'

import { loadCatalog, refresh } from './data'
import { renderPane } from './pane'

// The engine needs each atom declared in the file that reads it (data.ts and pane.tsx repeat this).
const view = atom({ plugin: 'delegate-panel', key: 'view' } as const, null, { shape: 'view-2' })

const PANE = 'delegate-jobs'
const TITLE = 'Delegation'
const REFRESH_MS = 2000

// Added to the system prompt in any repo with .delegate.json, so Claude routes work unasked.
export function autoDelegateRule(root: string): string {
  return [
    '# Auto-delegation (agent-delegate)',
    `This repository (${root}) has a .delegate.json. The user has pre-authorized delegation here: do not ask before delegating.`,
    'Before starting each task, route it with the agent-delegate skill and act on the result yourself:',
    '- Token-heavy work (reading or auditing many files, bulk docs, large mechanical refactors, long loops): delegate to agy.',
    '- Medium (Sonnet-class) work: features from a clear plan, content checks, test writing: delegate to agy with Gemini 4 Argon (--model gemini-4-argon-high), or to codex. A Sonnet subagent is only the fallback.',
    '- Menial work (renames, formatting, boilerplate, link checks): delegate to agy with Gemini 3.8 Flash, or codex.',
    '- Hard reasoning, planning, root-cause debugging, correctness of math or domain content, and reviewing delegated diffs: do these yourself.',
    '- Tasks that would cost you under ~2k tokens: do them yourself.',
    'Run, review and finish delegated jobs (accept, reject or escalate) per the skill, escalating at once when a delegate is stuck or weak.',
    'Model and effort for each agent are set by the user in the Delegation pane; if the user set a model there, do not pass --model; otherwise pass --model by tier (Argon for medium work, Flash for menial and bulk work).',
    'Say in one line what you delegated and to whom. Delegation never authorizes committing, pushing or adding dependencies.',
  ].join('\n')
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'delegate-panel', description: 'Show delegation jobs, live output and model controls' })
    await refresh($).catch(() => undefined)
    void loadCatalog($).catch(() => undefined)
    const v = await read($, view)
    if (v && !v.error) void $.ui.open({ id: PANE, title: TITLE })
    $.clock.every(REFRESH_MS, () => {
      void refresh($).catch(() => undefined)
    })
    return next(e)
  })

  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)
    const v = await read($, view)
    if (!v || v.error || !v.root) return composed
    return {
      ...composed,
      sections: [...composed.sections, { id: 'agent-delegate-auto', text: autoDelegateRule(v.root), scope: 'session' }],
    }
  })

  on('command.run', { command: 'delegate-panel' }, async $ => {
    await refresh($).catch(() => undefined)
    void loadCatalog($).catch(() => undefined)
    await $.ui.open({ id: PANE, title: TITLE })
    return { text: 'Delegation pane opened.' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => renderPane($, e))
}
