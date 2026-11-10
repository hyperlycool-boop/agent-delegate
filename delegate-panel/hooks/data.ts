import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { Catalog, Controls, DelegateView, Job, Output } from '../types'
import { parseLog } from './log'

const DEFAULT_LOG = '.delegate/log.jsonl'
const AGY_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max']
const LIVE_LINES = 40
const RESULT_CHARS = 6000

export const DEFAULT_CONTROLS: Controls = {
  mode: 'result',
  selected: '',
  agy: { model: '', effort: '' },
  codex: { model: '', effort: '' },
}

// Bump a shape tag when its type changes: it declines what an older version stored.
// The engine needs each atom declared in the file that reads or writes it, so register.tsx repeats these.
const view = atom({ plugin: 'delegate-panel', key: 'view' } as const, null, { shape: 'view-2' })
const catalog = atom({ plugin: 'delegate-panel', key: 'catalog' } as const, null, { shape: 'catalog-2' })
const output = atom({ plugin: 'delegate-panel', key: 'output' } as const, null, { shape: 'output-1' })
const controls = atom({ plugin: 'delegate-panel', key: 'controls' } as const, DEFAULT_CONTROLS, { shape: 'controls-1' })

type Paths = { root: string; delegateHome: string; home: string }
let paths: Paths | undefined
let lastLog = ''

async function readText($: EngineInterface, path: string): Promise<string> {
  return (await $.fs.exists(path)) ? $.fs.read(path) : ''
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

// Same folder agent-delegate's common.sh uses: ~/.cache/agent-delegate/<main repo folder name>.
async function findPaths($: EngineInterface, root: string): Promise<Paths> {
  const script = 'printf "%s\\n" "$HOME"; cd "$(git rev-parse --git-common-dir)/.." && basename "$PWD"'
  const { stdout } = await $.process.run(['sh', '-c', script], { cwd: root })
  const [home = '', repo = ''] = stdout.trim().split('\n')
  return { root, home, delegateHome: `${home}/.cache/agent-delegate/${repo}` }
}

export const overridesPath = (p: Paths) => `${p.delegateHome}/overrides.json`
export const currentPaths = () => paths

export async function loadCatalog($: EngineInterface): Promise<void> {
  if (!paths) return
  const agy = await $.process.run(['agy', 'models'], { timeoutMs: 30_000 }).catch(() => undefined)
  // `agy models` prints "slug<TAB>Display name" per model.
  const agyModels = (agy?.stdout ?? '')
    .split('\n')
    .filter(l => l.includes('\t'))
    .map(l => {
      const [slug = '', label = ''] = l.split('\t').map(s => s.trim())
      return { slug, label: label || slug }
    })
    .filter(m => m.slug !== '')
  let codexModels: Catalog['codexModels'] = []
  try {
    const cache = JSON.parse(await readText($, `${paths.home}/.codex/models_cache.json`)) as {
      models?: { slug?: string; display_name?: string; supported_reasoning_levels?: { effort?: string }[] }[]
    }
    codexModels = (cache.models ?? [])
      .filter(m => typeof m.slug === 'string')
      .map(m => ({
        slug: m.slug as string,
        label: m.display_name || (m.slug as string),
        efforts: (m.supported_reasoning_levels ?? []).map(l => l.effort ?? '').filter(Boolean),
      }))
  } catch {}
  const loadedTs = await $.clock.now()
  await update($, catalog, () => ({ agyModels, agyEfforts: AGY_EFFORTS, codexModels, loadedTs }))
}

export async function loadControls($: EngineInterface): Promise<void> {
  if (!paths) return
  try {
    const ov = JSON.parse(await readText($, overridesPath(paths))) as Partial<Controls>
    await update($, controls, c => ({
      ...c,
      agy: { ...DEFAULT_CONTROLS.agy, ...(ov.agy ?? {}) },
      codex: { ...DEFAULT_CONTROLS.codex, ...(ov.codex ?? {}) },
    }))
  } catch {}
}

// Writes only model and effort: the keys run.sh reads from overrides.json.
export async function saveControls($: EngineInterface, c: Controls): Promise<void> {
  if (!paths) return
  const body = { agy: c.agy, codex: c.codex }
  await $.fs.write(overridesPath(paths), JSON.stringify(body, null, 2) + '\n')
}

async function outputFor($: EngineInterface, job: Job | undefined, c: Controls): Promise<Output | null> {
  if (!job || !paths) return null
  const base = `${paths.delegateHome}/logs/${job.slug}.${job.agent}`
  if (c.mode === 'live') {
    const text = await readText($, job.live ?? `${base}.live`)
    const lines = text.trimEnd().split('\n')
    return { slug: job.slug, mode: 'live', text: lines.slice(-LIVE_LINES).join('\n') || '(no live output yet)' }
  }
  const text = (await readText($, job.last ?? `${base}.last.md`)).trim()
  const fallback = job.status === 'running' ? 'Still running. Switch to Live to watch it.' : '(no reply)'
  return { slug: job.slug, mode: 'result', text: text ? text.slice(0, RESULT_CHARS) : fallback }
}

export async function refresh($: EngineInterface): Promise<void> {
  const now = await $.clock.now()
  const root = await findRoot($)
  if (!root) {
    await update($, view, () => ({
      root: '', logPath: '', delegateHome: '', jobs: [], stats: [], updatedTs: now,
      error: 'No .delegate.json here. Run /delegate-init.',
    }))
    return
  }
  if (!paths || paths.root !== root) {
    paths = await findPaths($, root)
    await loadControls($)
  }
  let logPath = `${root}/${DEFAULT_LOG}`
  try {
    const conf = JSON.parse(await $.fs.read(`${root}/.delegate.json`)) as { log?: unknown }
    if (typeof conf.log === 'string') logPath = `${root}/${conf.log}`
  } catch {}

  const text = await readText($, logPath)
  const current = await read($, view)
  const isRunning = current?.jobs.some(j => j.status === 'running') ?? false
  if (text !== lastLog || !current || current.root !== root || isRunning) {
    lastLog = text
    const { jobs, stats } = parseLog(text)
    const next: DelegateView = { root, logPath, delegateHome: paths.delegateHome, jobs, stats, updatedTs: now }
    await update($, view, () => next)
  }

  const v = await read($, view)
  const c = await read($, controls)
  const job = v?.jobs.find(j => j.slug === c.selected) ?? v?.jobs[0]
  const out = await outputFor($, job, c)
  const prev = await read($, output)
  if (JSON.stringify(out) !== JSON.stringify(prev)) await update($, output, () => out)
}
