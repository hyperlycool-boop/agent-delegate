import { atom, read, update } from 'claude-code'
import type { EngineInterface, RenderChildren, RenderInput } from 'claude-code'

import type { AgentChoice, Controls, JobStatus, ModelInfo, WebState } from '../types'
import { currentPaths, DEFAULT_CONTROLS, loadCatalog, refresh, saveControls } from './data'
import { formatSeconds } from './log'

// The engine needs each atom declared in the file that reads or writes it (data.ts repeats these).
const view = atom({ plugin: 'delegate-panel', key: 'view' } as const, null, { shape: 'view-2' })
const catalog = atom({ plugin: 'delegate-panel', key: 'catalog' } as const, null, { shape: 'catalog-2' })
const output = atom({ plugin: 'delegate-panel', key: 'output' } as const, null, { shape: 'output-1' })
const controls = atom({ plugin: 'delegate-panel', key: 'controls' } as const, DEFAULT_CONTROLS, { shape: 'controls-1' })
const WEB_OFF: WebState = { status: 'off', url: 'http://127.0.0.1:4319', message: '' }
const web = atom({ plugin: 'delegate-panel', key: 'web' } as const, WEB_OFF, { shape: 'web-1' })

// Notion-style palette: one blue for actions and selection; sticker colours only for status dots.
const BLUE = '#0075de'
const DOT: Record<JobStatus, string> = {
  running: '#dd5b00', review: '#62aef0', accept: '#1aae39', reject: '#ff64c8', escalate: '#9b6fd6',
}
const AGENT_DOT: Record<string, string> = { agy: '#2a9d99', codex: '#9b6fd6' }
const LABEL: Record<JobStatus, string> = {
  running: 'Running', review: 'Waiting for review', accept: 'Accepted', reject: 'Rejected', escalate: 'Escalated',
}
const MAX_JOBS = 8

// Change controls from a handler, save model/effort for run.sh, then redraw the output.
export function setControls($: EngineInterface, fn: (c: Controls) => Controls): void {
  void (async () => {
    await update($, controls, fn)
    await saveControls($, await read($, controls))
    await refresh($)
  })().catch(() => undefined)
}

async function setWeb($: EngineInterface, patch: Partial<WebState>): Promise<void> {
  await update($, web, w => ({ ...w, ...patch }))
}

// Starts the agent-delegate web dashboard for this session (it stops with the session).
export function startWebDashboard($: EngineInterface): void {
  void (async () => {
    const p = currentPaths()
    const server = p ? `${p.home}/.claude/skills/agent-delegate/dashboard/server.js` : ''
    if (!p || !(await $.fs.exists(server))) {
      await setWeb($, { status: 'error', message: 'Dashboard not found. Is agent-delegate installed?' })
      return
    }
    await setWeb($, { status: 'starting', message: 'Starting…' })
    const child = $.process.spawn({ argv: ['node', server, '--port', '4319'], cwd: p.root })
    for await (const { stream, text } of child) {
      if (stream === 'stdout' && text.includes('http://')) {
        await setWeb($, { status: 'on', message: 'Running for this session.' })
      } else if (text.includes('EADDRINUSE')) {
        await setWeb($, { status: 'on', message: 'Already running.' })
      }
    }
    const w = await read($, web)
    if (w.status === 'starting') await setWeb($, { status: 'error', message: 'It stopped before it started.' })
  })().catch(async () => {
    await setWeb($, { status: 'error', message: 'Could not start node.' })
  })
}

export async function renderPane($: EngineInterface, e: RenderInput) {
  const els = $.ui.resolve(e)
  const { Box, Text, Button, Markdown, Link } = els
  const v = await read($, view)
  if (!v) return <Text dimColor>Loading delegation log…</Text>
  if (v.error) return <Text dimColor>{v.error}</Text>
  const c = await read($, controls)
  const out = await read($, output)
  const cat = await read($, catalog)
  const w = await read($, web)
  const now = await $.clock.now()
  const repo = v.root.split('/').pop() ?? v.root
  const selected = v.jobs.find(j => j.slug === c.selected)?.slug ?? v.jobs[0]?.slug

  const card = (key: string, title: string, meta: string, action: RenderChildren, body: RenderChildren) => (
    <Box key={key} flexDirection="column" borderStyle="round" borderColor="inactive" paddingX={2} paddingY={1} gap={1}>
      <Box flexDirection="row" justifyContent="space-between" gap={1}>
        <Box flexDirection="column">
          <Text weight="semibold" size="heading">{title}</Text>
          {meta !== '' && <Text dimColor size="footnote">{meta}</Text>}
        </Box>
        {action}
      </Box>
      {body}
    </Box>
  )

  // A choice list: Select where the surface has one, else a button that cycles.
  const choice = (key: string, label: string, value: string, values: ModelInfo[], fallback: string, onPick: (x: string) => void) => {
    const names = new Map(values.map(m => [m.slug, m.label]))
    const opts = ['', ...values.map(m => m.slug).filter(x => x !== '')]
    if (value !== '' && !names.has(value)) opts.push(value)
    const shown = (x: string) => (x === '' ? `Default${fallback ? ` (${fallback})` : ''}` : names.get(x) ?? `${x} (not in list)`)
    if ('Select' in els) {
      const { Select } = els
      return <Select key={key} label={label} value={value} options={opts.map(x => ({ value: x, label: shown(x) }))} onSelect={x => onPick(x)} />
    }
    const nextValue = opts[(opts.indexOf(value) + 1) % opts.length] ?? ''
    return <Button key={key} label={`${label}: ${shown(value)}`} onPress={() => onPick(nextValue)} />
  }
  const asInfo = (xs: string[]): ModelInfo[] => xs.map(x => ({ slug: x, label: x }))
  const agentRow = (agent: 'agy' | 'codex', models: ModelInfo[], efforts: ModelInfo[]) => {
    const pick = (field: keyof AgentChoice) => (x: string) => setControls($, cur => ({ ...cur, [agent]: { ...cur[agent], [field]: x } }))
    return (
      <Box key={`row-${agent}`} flexDirection="column">
        <Text weight="semibold"><Text color={AGENT_DOT[agent]}>● </Text>{agent}</Text>
        <Box flexDirection="row" gap={2} flexWrap="wrap">
          {choice(`${agent}-model`, 'Model', c[agent].model, models, '', pick('model'))}
          {choice(`${agent}-effort`, 'Effort', c[agent].effort, efforts, '', pick('effort'))}
        </Box>
      </Box>
    )
  }
  const codexModel = cat?.codexModels.find(m => m.slug === c.codex.model)
  const codexEfforts = codexModel?.efforts ?? [...new Set(cat?.codexModels.flatMap(m => m.efforts) ?? [])]

  const jobsBody = v.jobs.length === 0
    ? <Text dimColor>No delegated jobs yet. Run /agent-delegate:delegate in Claude Code.</Text>
    : (
      <Box flexDirection="column">
        {v.jobs.slice(0, MAX_JOBS).map(job => {
          const isSel = job.slug === selected
          const secs = job.status === 'running' && job.startedTs !== undefined
            ? Math.max(0, Math.round((now - job.startedTs) / 1000)) : job.seconds
          const checks = job.status === 'running' ? '' : ` · build ${job.build ?? '?'} · tests ${job.tests ?? '?'}`
          const setup = job.model ? ` · ${job.model}${job.effort && job.effort !== 'default' ? ` / ${job.effort}` : ''}` : ''
          return (
            <Box key={`row-${job.slug}`} flexDirection="column" paddingRight={1}>
              <Box flexDirection="row" justifyContent="space-between" gap={1}>
                <Button key={`job-${job.slug}`} plain label={`Show ${job.slug}`}
                  onPress={() => setControls($, cur => ({ ...cur, selected: job.slug }))}>
                  <Text color={isSel ? BLUE : undefined}>{isSel ? '▍' : ' '}</Text>
                  <Text color={DOT[job.status]}>● </Text>
                  <Text weight={isSel ? 'semibold' : 'medium'}>{job.slug}</Text>
                </Button>
                <Text dimColor>{secs !== undefined ? formatSeconds(secs) : ''}</Text>
              </Box>
              <Text dimColor size="footnote">{`   ${LABEL[job.status]} · ${job.agent}${checks}${setup}`}</Text>
            </Box>
          )
        })}
      </Box>
    )

  const modeButtons = (
    <Box flexDirection="row" gap={1}>
      <Button key="mode-result" label="Result" variant={c.mode === 'result' ? 'primary' : 'secondary'}
        onPress={() => setControls($, cur => ({ ...cur, mode: 'result' }))} />
      <Button key="mode-live" label="Live" variant={c.mode === 'live' ? 'primary' : 'secondary'}
        onPress={() => setControls($, cur => ({ ...cur, mode: 'live' }))} />
    </Box>
  )
  const outBody = !out
    ? <Text dimColor>Select a job to see its output.</Text>
    : out.mode === 'result'
      ? <Markdown key="result" text={out.text} />
      : <Box flexDirection="column" paddingX={1}>{out.text.split('\n').map(line => <Text mono dimColor>{line}</Text>)}</Box>

  const statsBody = v.stats.length === 0
    ? <Text dimColor>No runs logged yet.</Text>
    : (
      <Box flexDirection="column">
        <Text mono dimColor size="footnote">{'AGENT  RUNS  AVG      FAILED  ACCEPTED  REJECTED  ESCALATED'}</Text>
        {v.stats.map(s => (
          <Text mono>
            {`${s.agent.padEnd(7)}${String(s.runs).padEnd(6)}${formatSeconds(s.avgSeconds).padEnd(9)}${String(s.failed).padEnd(8)}${String(s.accept).padEnd(10)}${String(s.reject).padEnd(10)}${s.escalate}`}
          </Text>
        ))}
      </Box>
    )

  const webAction = w.status === 'on'
    ? <Link href={w.url} label="Open" />
    : <Button key="web-start" label={w.status === 'starting' ? 'Starting…' : 'Start'} onPress={() => startWebDashboard($)} />
  const webMeta = w.status === 'on' ? `${w.url} · ${w.message}` : w.message || 'Same view in your browser, full width.'

  return (
    <Box flexDirection="column" gap={1}>
      <Box flexDirection="column">
        <Text dimColor size="caption" weight="semibold">DELEGATION</Text>
        <Text weight="bold" size="title">Jobs handed off to agy and Codex</Text>
        <Text><Text color={BLUE} weight="semibold">{repo}</Text><Text dimColor>{'  ·  Pick a job, read its result or watch it live.'}</Text></Text>
      </Box>
      {card('jobs', 'Jobs', v.jobs.length ? `${Math.min(v.jobs.length, MAX_JOBS)} shown` : '', null, jobsBody)}
      {card('output', 'Output', out ? `${out.slug} · ${out.mode === 'live' ? 'live progress' : 'final reply'}` : '', modeButtons, outBody)}
      {card('models', 'Models',
        cat ? `${cat.agyModels.length} agy and ${cat.codexModels.length} codex models · used by the next run` : 'Loading model lists…',
        <Button key="refresh-models" label="Refresh" onPress={() => void loadCatalog($).catch(() => undefined)} />,
        <Box flexDirection="column" gap={1}>
          {agentRow('agy', cat?.agyModels ?? [], asInfo(cat?.agyEfforts ?? []))}
          {agentRow('codex', cat?.codexModels ?? [], asInfo(codexEfforts))}
        </Box>)}
      {card('stats', 'Agents', '', null, statsBody)}
      {card('web', 'Web dashboard', webMeta, webAction, null)}
    </Box>
  )
}
