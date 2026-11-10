import { expect, test } from 'claude-code/testing'

import { parseLog } from './log'
import { autoDelegateRule } from './register'

const LOG = [
  '{"date":"2026-11-10","slug":"credits-audit","agent":"agy","seconds":326,"agent_exit":0,"build":"PASS","tests":"PASS","files":1,"verdict":"pending"}',
  '{"date":"2026-11-10","slug":"credits-audit","verdict":"accept","note":"ok"}',
  '{"date":"2026-11-10","slug":"credits-test","agent":"codex","seconds":95,"agent_exit":0,"build":"PASS","tests":"FAIL","files":0,"verdict":"pending"}',
  '{"date":"2026-11-10","ts":1000,"event":"start","slug":"link-audit","agent":"agy","model":"gemini-3.8-flash-low","effort":"high","live":"/h/live","last":"/h/last"}',
].join('\n')

const FILES: Record<string, string> = {
  '/repo/.delegate.json': '{"log":"docs/delegate/log.jsonl"}',
  '/repo/docs/delegate/log.jsonl': LOG,
  '/h/live': 'start  agy\n>      view_file {"AbsolutePath":"src/a.ts"}\nok     view_file (0.1s)\n',
  '/h/last': '',
  '/home/.cache/agent-delegate/repo/overrides.json': '{"agy":{"model":"gemini-3.8-flash-low","effort":"high"}}',
  '/home/.codex/models_cache.json': '{"models":[{"slug":"gpt-5.6-luna","supported_reasoning_levels":[{"effort":"low"},{"effort":"high"}]}]}',
}

const PANE = {
  plugin: 'delegate-panel',
  component: 'Pane',
  requestId: 'delegate-jobs',
  props: {
    title: 'Delegation',
    isFocused: false,
    bodyColumns: 100,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const

test('parseLog builds jobs newest first, with model and output paths', () => {
  const { jobs, stats } = parseLog(LOG)
  expect(jobs.map(j => `${j.slug}:${j.status}`)).toEqual([
    'link-audit:running',
    'credits-test:review',
    'credits-audit:accept',
  ])
  expect(jobs[0]?.model).toBe('gemini-3.8-flash-low')
  expect(jobs[0]?.live).toBe('/h/live')
  expect(stats.find(s => s.agent === 'codex')?.failed).toBe(1)
})

test('the auto-delegation rule names the repo and pre-authorizes delegation', () => {
  const rule = autoDelegateRule('/repo')
  expect(rule).toContain('/repo')
  expect(rule).toContain('do not ask before delegating')
  expect(rule).toContain('never authorizes committing')
  expect(rule).toContain('gemini-4-argon-high')
})

test('the pane shows jobs, the result fallback, and saved model choices', async ($, on) => {
  on('command.register', () => ({ value: { command: 'delegate-panel' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: '/repo' }))
  on('clock.now', () => ({ value: 61_000 }))
  on('process.run', (_, e) =>
    e.argv[0] === 'agy'
      ? { value: { exitCode: 0, stdout: 'Fetching...\ngemini-3.8-flash-low\tLow\ngemini-3.8-flash-high\tHigh\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
      : { value: { exitCode: 0, stdout: '/home\nrepo\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } },
  )
  on('fs.exists', (_, e) => ({ value: String(e.path) in FILES }))
  on('fs.read', (_, e) => ({ value: FILES[String(e.path)] ?? '' }))

  await $.session.start({ cwd: '/repo', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })

  expect((await ui.find({ type: 'Text', text: /^link-audit$/ }))?.text).toBe('link-audit')
  expect((await ui.find({ type: 'Text', text: /^1m 00s$/ }))?.text).toBe('1m 00s')
  expect((await ui.find({ type: 'Text', text: /Running · agy/ }))?.text).toContain('gemini-3.8-flash-low / high')
  expect((await ui.find({ type: 'Markdown' }))?.props?.text).toBe('Still running. Switch to Live to watch it.')
  expect((await ui.find({ type: 'Select', key: 'agy-model' }))?.props?.value).toBe('gemini-3.8-flash-low')
  await ui.unmount()
})

test('the model controls draw on terminal, desktop and vscode', async ($, on) => {
  on('session.cwd', () => ({ value: '/repo' }))
  on('clock.now', () => ({ value: 61_000 }))
  on('clock.every', () => ({ value: undefined }))
  on('process.run', () => ({ value: { exitCode: 0, stdout: '/home\nrepo\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('fs.exists', (_, e) => ({ value: String(e.path) in FILES }))
  on('fs.read', (_, e) => ({ value: FILES[String(e.path)] ?? '' }))
  on('command.register', () => ({ value: { command: 'delegate-panel' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))

  await $.session.start({ cwd: '/repo', surface: 'desktop', isInteractive: true })
  for (const surface of ['terminal', 'desktop', 'vscode'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect((await ui.find({ type: 'Select', key: 'codex-effort' }))?.props?.value).toBe('')
    await ui.unmount()
  }
})
