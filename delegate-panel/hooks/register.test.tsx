import { expect, test } from 'claude-code/testing'

import { parseLog } from './log'
import { autoDelegateRule } from './register'

const LOG = [
  '{"date":"2026-11-10","slug":"credits-audit","agent":"agy","seconds":326,"agent_exit":0,"build":"PASS","tests":"PASS","files":1,"verdict":"pending"}',
  '{"date":"2026-11-10","slug":"credits-audit","verdict":"accept","note":"ok"}',
  '{"date":"2026-11-10","slug":"credits-test","agent":"codex","seconds":95,"agent_exit":0,"build":"PASS","tests":"FAIL","files":0,"verdict":"pending"}',
  '{"date":"2026-11-10","ts":1000,"event":"start","slug":"link-audit","agent":"agy"}',
].join('\n')

const PANE = {
  plugin: 'delegate-panel',
  component: 'Pane',
  requestId: 'delegate-jobs',
  props: {
    title: 'Delegation',
    isFocused: false,
    bodyColumns: 80,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 20 },
    view: {},
  },
} as const

test('parseLog builds jobs newest first and per-agent stats', () => {
  const { jobs, stats } = parseLog(LOG)
  expect(jobs.map(j => `${j.slug}:${j.status}`)).toEqual([
    'link-audit:running',
    'credits-test:review',
    'credits-audit:accept',
  ])
  const agy = stats.find(s => s.agent === 'agy')
  const codex = stats.find(s => s.agent === 'codex')
  expect(agy?.runs).toBe(1)
  expect(agy?.accept).toBe(1)
  expect(codex?.failed).toBe(1)
})

test('the auto-delegation rule names the repo and pre-authorizes delegation', () => {
  const rule = autoDelegateRule('/repo')
  expect(rule).toContain('/repo')
  expect(rule).toContain('do not ask before delegating')
  expect(rule).toContain('never authorizes committing')
})

test('the pane shows a running job and agent stats', async ($, on) => {
  on('command.register', () => ({ value: { command: 'delegate-panel' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: '/repo' }))
  on('clock.now', () => ({ value: 61_000 }))
  on('fs.exists', () => ({ value: true }))
  on('fs.read', (_, e) =>
    String(e.path).endsWith('.delegate.json')
      ? { value: '{"log":"docs/delegate/log.jsonl"}' }
      : { value: LOG },
  )

  await $.session.start({ cwd: '/repo', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })

  expect((await ui.find({ type: 'Text', text: /link-audit/ }))?.text).toBe('link-audit')
  expect((await ui.find({ type: 'Text', text: /^1m 00s/ }))?.text).toBe('1m 00s')
  expect((await ui.find({ type: 'Text', text: /^codex.*runs/ }))?.text).toContain('1 failed')
  await ui.unmount()
})
