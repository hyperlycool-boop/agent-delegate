// Turns agent-delegate's log.jsonl into jobs (newest first) and per-agent stats.
// Same rules as the Delegation pane's hooks/log.ts.
// Line kinds: {event:"start",slug,agent,ts,...} · {slug,agent,seconds,build,tests,...} · {slug,verdict,note}
const VERDICTS = ['accept', 'reject', 'escalate']
const num = v => (typeof v === 'number' ? v : undefined)
const str = v => (typeof v === 'string' ? v : undefined)

function parseLog(text, maxJobs = 20) {
  const jobs = new Map()
  const order = []
  const stats = new Map()
  const touch = slug => {
    const at = order.indexOf(slug)
    if (at >= 0) order.splice(at, 1)
    order.push(slug)
  }
  const statFor = agent => {
    if (!stats.has(agent)) stats.set(agent, { agent, runs: 0, totalSeconds: 0, failed: 0, accept: 0, reject: 0, escalate: 0 })
    return stats.get(agent)
  }

  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    let e
    try { e = JSON.parse(line) } catch { continue }
    const slug = str(e.slug)
    if (!slug) continue
    const agent = str(e.agent)
    const extra = { model: str(e.model), effort: str(e.effort), live: str(e.live), last: str(e.last) }

    if (e.event === 'start' && agent) {
      jobs.set(slug, { slug, agent, status: 'running', startedTs: num(e.ts), ...extra })
      touch(slug)
    } else if (agent) {
      const prev = jobs.get(slug) || {}
      const job = {
        slug, agent, status: 'review', startedTs: prev.startedTs,
        model: extra.model ?? prev.model, effort: extra.effort ?? prev.effort,
        live: extra.live ?? prev.live, last: extra.last ?? prev.last,
        seconds: num(e.seconds), build: str(e.build), tests: str(e.tests),
        files: num(e.files), agentExit: num(e.agent_exit),
      }
      jobs.set(slug, job)
      touch(slug)
      const s = statFor(agent)
      s.runs += 1
      s.totalSeconds += job.seconds || 0
      if (job.build === 'FAIL' || job.tests === 'FAIL' || (job.agentExit || 0) !== 0) s.failed += 1
    } else if (VERDICTS.includes(e.verdict) && jobs.has(slug)) {
      const job = jobs.get(slug)
      jobs.set(slug, { ...job, status: e.verdict, note: str(e.note) })
      touch(slug)
      statFor(job.agent)[e.verdict] += 1
    }
  }

  return {
    jobs: order.map(s => jobs.get(s)).reverse().slice(0, maxJobs),
    stats: [...stats.values()].map(({ totalSeconds, ...s }) => ({
      ...s, avgSeconds: s.runs ? Math.round(totalSeconds / s.runs) : 0,
    })),
  }
}

module.exports = { parseLog }
