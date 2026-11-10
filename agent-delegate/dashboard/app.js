// Delegation dashboard client: polls the local server and draws jobs, output, models and stats.
const STATE_MS = 2000
const OUTPUT_MS = 1500
const $ = id => document.getElementById(id)

const prefs = (() => {
  try { return JSON.parse(localStorage.getItem('agent-delegate:ui') || '{}') } catch { return {} }
})()
let selected = prefs.selected || ''
let mode = prefs.mode === 'live' ? 'live' : 'result'
let state = null
const savePrefs = () => {
  try { localStorage.setItem('agent-delegate:ui', JSON.stringify({ selected, mode })) } catch {}
}

const fmt = s => (s == null ? '' : s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`)
const LABEL = { running: 'Running', review: 'Waiting for review', accept: 'Accepted', reject: 'Rejected', escalate: 'Escalated' }

async function api(path, init) {
  const res = await fetch(path, init)
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
  return res.json()
}

function drawJobs() {
  const list = $('jobs')
  const jobs = state.jobs
  $('jobs-empty').hidden = jobs.length > 0
  $('jobs-count').textContent = jobs.length ? `${jobs.length} shown` : ''
  if (!jobs.some(j => j.slug === selected)) selected = jobs[0]?.slug || ''
  list.replaceChildren(...jobs.map(job => {
    const li = document.createElement('li')
    li.className = 'job'
    li.setAttribute('role', 'option')
    li.tabIndex = 0
    li.setAttribute('aria-selected', String(job.slug === selected))
    const secs = job.status === 'running' && job.startedTs ? Math.max(0, Math.round((state.now - job.startedTs) / 1000)) : job.seconds
    const checks = job.status === 'running' ? '' : ` · build ${job.build || '?'} · tests ${job.tests || '?'}`
    const setup = job.model ? ` · ${job.model}${job.effort && job.effort !== 'default' ? ` / ${job.effort}` : ''}` : ''
    const dot = document.createElement('span'); dot.className = `dot dot--${job.status}`; dot.title = LABEL[job.status]
    const slug = document.createElement('span'); slug.className = 'job__slug'; slug.textContent = job.slug
    const time = document.createElement('span'); time.className = 'job__time'; time.textContent = fmt(secs)
    const sub = document.createElement('span'); sub.className = 'job__sub'
    sub.textContent = `${LABEL[job.status]} · ${job.agent}${checks}${setup}`
    li.append(dot, slug, time, sub)
    const pick = () => { selected = job.slug; savePrefs(); drawJobs(); loadOutput() }
    li.addEventListener('click', pick)
    li.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick() } })
    return li
  }))
}

function fillSelect(select, items, value, defaultLabel) {
  const opts = [{ value: '', label: `Default (${defaultLabel || 'agent default'})` }, ...items]
  if (value && !items.some(i => i.value === value)) opts.push({ value, label: `${value} (not in list)` })
  if (document.activeElement === select && select.options.length === opts.length) return
  select.replaceChildren(...opts.map(o => new Option(o.label, o.value, false, o.value === value)))
}

function drawModels() {
  const cat = state.catalog
  $('models-meta').textContent = cat
    ? `${cat.agyModels.length} agy and ${cat.codexModels.length} codex models, listed ${fmt(Math.round((state.now - cat.loadedTs) / 1000))} ago`
    : 'Loading model lists…'
  for (const agent of ['agy', 'codex']) {
    const row = document.querySelector(`.model-row[data-agent="${agent}"]`)
    const cur = state.controls[agent]
    const def = state.defaults[agent]
    const models = agent === 'agy' ? cat?.agyModels || [] : cat?.codexModels || []
    const effortList = agent === 'agy'
      ? cat?.agyEfforts || []
      : (cat?.codexModels.find(m => m.slug === (cur.model || def.model))?.efforts || [])
    fillSelect(row.querySelector('[data-field="model"]'), models.map(m => ({ value: m.slug, label: m.label })), cur.model, def.model)
    fillSelect(row.querySelector('[data-field="effort"]'), effortList.map(e => ({ value: e, label: e })), cur.effort, def.effort)
  }
}

function drawStats() {
  $('stats').replaceChildren(...(state.stats.length ? state.stats : [null]).map(s => {
    const tr = document.createElement('tr')
    const cells = s ? [s.agent, s.runs, fmt(s.avgSeconds), s.failed, s.accept, s.reject, s.escalate] : ['No runs logged yet', '', '', '', '', '', '']
    tr.replaceChildren(...cells.map(v => { const td = document.createElement('td'); td.textContent = String(v); return td }))
    return tr
  }))
}

async function loadState() {
  try {
    state = await api('/api/state')
    $('repo').textContent = state.repo
    $('status').textContent = `Updated ${new Date(state.now).toLocaleTimeString()}`
    drawJobs(); drawModels(); drawStats()
  } catch (err) {
    $('status').textContent = `Server not reachable (${err.message})`
  }
}

async function loadOutput() {
  const out = $('output')
  document.querySelectorAll('.segmented__btn').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.mode === mode)))
  out.classList.toggle('output--result', mode === 'result')
  if (!selected) { $('output-job').textContent = 'No job selected'; out.textContent = ''; return }
  try {
    const data = await api(`/api/output?slug=${encodeURIComponent(selected)}&mode=${mode}`)
    $('output-job').textContent = `${data.slug} · ${mode === 'live' ? 'live progress' : 'final reply'}`
    const atBottom = out.scrollTop + out.clientHeight >= out.scrollHeight - 8
    if (out.textContent !== data.text) {
      out.textContent = data.text
      if (mode === 'live' && atBottom) out.scrollTop = out.scrollHeight
    }
  } catch (err) {
    out.textContent = `Could not load output (${err.message})`
  }
}

document.querySelectorAll('.segmented__btn').forEach(btn => btn.addEventListener('click', () => {
  mode = btn.dataset.mode; savePrefs(); loadOutput()
}))

document.querySelectorAll('.model-row select').forEach(select => select.addEventListener('change', async () => {
  const body = {}
  for (const row of document.querySelectorAll('.model-row')) {
    body[row.dataset.agent] = {
      model: row.querySelector('[data-field="model"]').value,
      effort: row.querySelector('[data-field="effort"]').value,
    }
  }
  try {
    const saved = await api('/api/controls', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    state.controls = saved
    $('models-saved').textContent = 'Saved. The next run uses these.'
    drawModels()
  } catch (err) {
    $('models-saved').textContent = `Not saved (${err.message})`
  }
}))

$('refresh-models').addEventListener('click', async e => {
  const btn = e.currentTarget
  btn.disabled = true; btn.textContent = 'Refreshing…'
  try { state.catalog = await api('/api/models/refresh', { method: 'POST' }); drawModels() } catch {}
  btn.disabled = false; btn.textContent = 'Refresh models'
})

loadState().then(loadOutput)
setInterval(loadState, STATE_MS)
setInterval(loadOutput, OUTPUT_MS)
