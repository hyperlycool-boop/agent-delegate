// Local web dashboard for agent-delegate. No dependencies: Node's own http module.
// Usage (from inside a repo with .delegate.json): node server.js [--port 4319]
// Listens on 127.0.0.1 only. Reads the delegation log and job output files;
// writes only ~/.cache/agent-delegate/<repo>/overrides.json (model and effort).
const http = require('http')
const fs = require('fs')
const path = require('path')
const { execFileSync, execFile } = require('child_process')
const { parseLog } = require('./log')

const HOST = '127.0.0.1'
const PORT = Number(process.argv[process.argv.indexOf('--port') + 1]) || Number(process.env.PORT) || 4319
const AGY_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max']
const LIVE_LINES = 60
const RESULT_CHARS = 20000
const STATIC = { '/': 'index.html', '/app.js': 'app.js', '/style.css': 'style.css' }
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' }

const git = args => execFileSync('git', args, { encoding: 'utf8' }).trim()
const ROOT = git(['rev-parse', '--show-toplevel'])
const REPO = path.basename(path.resolve(git(['rev-parse', '--git-common-dir']), '..'))
const HOME = process.env.HOME || ''
const DELEGATE_HOME = path.join(HOME, '.cache', 'agent-delegate', REPO)
const OVERRIDES = path.join(DELEGATE_HOME, 'overrides.json')

const readText = file => {
  try { return fs.readFileSync(file, 'utf8') } catch { return '' }
}
const readJson = file => {
  try { return JSON.parse(readText(file)) } catch { return {} }
}
const logPath = () => {
  const conf = readJson(path.join(ROOT, '.delegate.json'))
  return path.join(ROOT, typeof conf.log === 'string' ? conf.log : '.delegate/log.jsonl')
}
const controls = () => {
  const ov = readJson(OVERRIDES)
  const pick = a => ({ model: String(ov[a]?.model ?? ''), effort: String(ov[a]?.effort ?? '') })
  return { agy: pick('agy'), codex: pick('codex') }
}
const defaults = () => {
  const conf = readJson(path.join(ROOT, '.delegate.json'))
  return {
    agy: { model: conf.agy?.model || 'gemini-3.8-flash-high', effort: conf.agy?.effort || '' },
    codex: { model: conf.codex?.model || 'gpt-5.6-luna', effort: conf.codex?.effort || '' },
  }
}

let catalog = null
function loadCatalog() {
  return new Promise(resolve => {
    execFile('agy', ['models'], { timeout: 30000 }, (_err, stdout = '') => {
      const agyModels = stdout.split('\n').filter(l => l.includes('\t')).map(l => {
        const [slug = '', label = ''] = l.split('\t').map(s => s.trim())
        return { slug, label: label || slug }
      }).filter(m => m.slug)
      const cache = readJson(path.join(HOME, '.codex', 'models_cache.json'))
      const codexModels = (cache.models || []).filter(m => typeof m.slug === 'string').map(m => ({
        slug: m.slug,
        label: m.display_name || m.slug,
        efforts: (m.supported_reasoning_levels || []).map(l => l.effort).filter(Boolean),
      }))
      catalog = { agyModels, agyEfforts: AGY_EFFORTS, codexModels, loadedTs: Date.now() }
      resolve(catalog)
    })
  })
}

function output(slug, mode) {
  const { jobs } = parseLog(readText(logPath()), 200)
  const job = jobs.find(j => j.slug === slug)
  if (!job) return { slug, mode, text: '' }
  const base = path.join(DELEGATE_HOME, 'logs', `${job.slug}.${job.agent}`)
  if (mode === 'live') {
    const lines = readText(job.live || `${base}.live`).trimEnd().split('\n')
    return { slug, mode, text: lines.slice(-LIVE_LINES).join('\n') || '(no live output yet)' }
  }
  const text = readText(job.last || `${base}.last.md`).trim()
  const fallback = job.status === 'running' ? 'Still running. Switch to Live to watch it.' : '(no reply)'
  return { slug, mode, text: text ? text.slice(0, RESULT_CHARS) : fallback }
}

// Only model and effort strings for the two known agents are accepted.
function saveControls(body) {
  const clean = s => (typeof s === 'string' && /^[A-Za-z0-9._-]{0,80}$/.test(s) ? s : '')
  const next = {}
  for (const a of ['agy', 'codex']) next[a] = { model: clean(body?.[a]?.model), effort: clean(body?.[a]?.effort) }
  fs.mkdirSync(DELEGATE_HOME, { recursive: true })
  fs.writeFileSync(OVERRIDES, JSON.stringify(next, null, 2) + '\n')
  return next
}

const send = (res, code, body, type = 'application/json; charset=utf-8') => {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' })
  res.end(typeof body === 'string' ? body : JSON.stringify(body))
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${HOST}`)
  // Refuse requests from other sites' pages (a browser sends Origin on cross-site fetches).
  const origin = req.headers.origin
  if (origin && origin !== `http://${HOST}:${PORT}` && origin !== `http://localhost:${PORT}`) return send(res, 403, { error: 'forbidden' })
  try {
    if (req.method === 'GET' && STATIC[url.pathname]) {
      const file = path.join(__dirname, STATIC[url.pathname])
      return send(res, 200, fs.readFileSync(file, 'utf8'), TYPES[path.extname(file)])
    }
    if (req.method === 'GET' && url.pathname === '/api/state') {
      const { jobs, stats } = parseLog(readText(logPath()), 50)
      if (!catalog) await loadCatalog()
      return send(res, 200, { repo: REPO, root: ROOT, jobs, stats, controls: controls(), defaults: defaults(), catalog, now: Date.now() })
    }
    if (req.method === 'GET' && url.pathname === '/api/output') {
      return send(res, 200, output(url.searchParams.get('slug') || '', url.searchParams.get('mode') === 'live' ? 'live' : 'result'))
    }
    if (req.method === 'POST' && url.pathname === '/api/models/refresh') return send(res, 200, await loadCatalog())
    if (req.method === 'POST' && url.pathname === '/api/controls') {
      let raw = ''
      for await (const chunk of req) { raw += chunk; if (raw.length > 4096) return send(res, 413, { error: 'too large' }) }
      return send(res, 200, saveControls(JSON.parse(raw || '{}')))
    }
    send(res, 404, { error: 'not found' })
  } catch (err) {
    send(res, 500, { error: String(err && err.message ? err.message : err) })
  }
})

server.listen(PORT, HOST, () => console.log(`agent-delegate dashboard for ${REPO}: http://${HOST}:${PORT}`))
