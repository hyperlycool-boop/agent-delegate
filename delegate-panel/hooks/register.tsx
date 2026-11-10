import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { DelegateView, JobStatus } from '../types'
import { formatSeconds, parseLog } from './log'

const PANE = 'delegate-jobs'
const TITLE = 'Delegation'
const REFRESH_MS = 2000
const DEFAULT_LOG = '.delegate/log.jsonl'

// Bump the shape tag when DelegateView changes: it declines what an older version stored.
const view = atom({ plugin: 'delegate-panel', key: 'view' } as const, null, { shape: 'view-1' })

const STATUS_COLOR: Record<JobStatus, string> = {
  running: 'warning',
  review: 'suggestion',
  accept: 'success',
  reject: 'error',
  escalate: 'warning',
}

// Walk up from the session folder to the repo that has .delegate.json.
async function findRoot($: EngineInterface): Promise<string | undefined> {
  let dir = await $.session.cwd()
  for (let i = 0; i < 30; i++) {
    if (await $.fs.exists(`${dir}/.delegate.json`)) return dir
    const parent = dir.replace(/\/[^/]+\/?$/, '')
    if (!parent || parent === dir) return undefined
    dir = parent
  }
  return undefined
}

async function logPathFor($: EngineInterface, root: string): Promise<string> {
  try {
    const conf = JSON.parse(await $.fs.read(`${root}/.delegate.json`)) as { log?: unknown }
    return `${root}/${typeof conf.log === 'string' ? conf.log : DEFAULT_LOG}`
  } catch {
    return `${root}/${DEFAULT_LOG}`
  }
}

// Added to the system prompt in any repo with .delegate.json, so Claude routes work unasked.
export function autoDelegateRule(root: string): string {
  return [
    '# Auto-delegation (agent-delegate)',
    `This repository (${root}) has a .delegate.json. The user has pre-authorized delegation here: do not ask before delegating.`,
    'Before starting each task, route it with the agent-delegate skill and act on the result yourself:',
    '- Token-heavy work (reading or auditing many files, bulk docs, large mechanical refactors, long loops): delegate to agy.',
    '- Small or medium code edits and tests from a clear plan: delegate to codex.',
    '- Hard reasoning, planning, root-cause debugging, correctness of math or domain content, and reviewing delegated diffs: do these yourself.',
    '- Tasks that would cost you under ~2k tokens: do them yourself.',
    'Run, review and finish delegated jobs (accept, reject or escalate) per the skill, escalating at once when a delegate is stuck or weak.',
    'Say in one line what you delegated and to whom. Delegation never authorizes committing, pushing or adding dependencies.',
  ].join('\n')
}

let lastText = ''

async function refresh($: EngineInterface): Promise<void> {
  const root = await findRoot($)
  const now = await $.clock.now()
  if (!root) {
    await update($, view, () => ({ root: '', logPath: '', jobs: [], stats: [], error: 'No .delegate.json here. Run /delegate-init.', updatedTs: now }))
    return
  }
  const logPath = await logPathFor($, root)
  const text = (await $.fs.exists(logPath)) ? await $.fs.read(logPath) : ''
  const current = await read($, view)
  const isRunning = current?.jobs.some(j => j.status === 'running') ?? false
  if (text === lastText && current && current.root === root && !isRunning) return
  lastText = text
  const { jobs, stats } = parseLog(text)
  const next: DelegateView = { root, logPath, jobs, stats, updatedTs: now }
  await update($, view, () => next)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'delegate-panel',
      description: 'Show delegation jobs and agent stats in a pane',
    })
    await refresh($).catch(() => undefined)
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
    await $.ui.open({ id: PANE, title: TITLE })

    return { text: 'Delegation pane opened.' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const v = await read($, view)
    const now = await $.clock.now()

    if (!v) return <Text dimColor>Loading delegation log…</Text>
    if (v.error) return <Text dimColor>{v.error}</Text>

    const repo = v.root.split('/').pop() ?? v.root
    const room = Math.max(3, (e.viewport?.rows ?? 24) - 6 - v.stats.length)

    return (
      <Box flexDirection="column">
        <Text weight="semibold">Jobs · {repo}</Text>
        {v.jobs.length === 0 && <Text dimColor>No delegated jobs yet. Try /delegate.</Text>}
        {v.jobs.slice(0, room).map(job => {
          const secs =
            job.status === 'running' && job.startedTs !== undefined
              ? Math.max(0, Math.round((now - job.startedTs) / 1000))
              : job.seconds
          const checks =
            job.status === 'running'
              ? ''
              : ` · build ${job.build ?? '?'} · tests ${job.tests ?? '?'} · ${job.files ?? 0} files${(job.agentExit ?? 0) !== 0 ? ` · exit ${job.agentExit}` : ''}`

          return (
            <Box flexDirection="row" gap={1}>
              <Text mono color={STATUS_COLOR[job.status]}>{job.status.padEnd(8)}</Text>
              <Text mono>{job.agent.padEnd(5)}</Text>
              <Text>{job.slug}</Text>
              <Text dimColor>
                {secs !== undefined ? formatSeconds(secs) : ''}
                {checks}
              </Text>
            </Box>
          )
        })}
        <Text weight="semibold">Agents</Text>
        {v.stats.length === 0 && <Text dimColor>No runs logged.</Text>}
        {v.stats.map(s => (
          <Text mono>
            {s.agent.padEnd(5)} {s.runs} runs · avg {formatSeconds(s.avgSeconds)} · {s.failed} failed · {s.accept} accepted · {s.reject} rejected · {s.escalate} escalated
          </Text>
        ))}
      </Box>
    )
  })
}
