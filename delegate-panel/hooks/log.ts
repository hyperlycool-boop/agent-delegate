import type { AgentStat, Job, JobStatus } from '../types'

type Entry = Record<string, unknown>

type Verdict = Extract<JobStatus, 'accept' | 'reject' | 'escalate'>
const VERDICTS: readonly Verdict[] = ['accept', 'reject', 'escalate']

const num = (v: unknown): number | undefined => (typeof v === 'number' ? v : undefined)
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined)

// Turns agent-delegate's log.jsonl into jobs (newest first) and per-agent stats.
// Line kinds: {event:"start",slug,agent,ts} · {slug,agent,seconds,build,tests,...} · {slug,verdict,note}
export function parseLog(text: string, maxJobs = 20): { jobs: Job[]; stats: AgentStat[] } {
  const jobs = new Map<string, Job>()
  const order: string[] = []
  const stats = new Map<string, AgentStat & { totalSeconds: number }>()
  const touch = (slug: string) => {
    const at = order.indexOf(slug)
    if (at >= 0) order.splice(at, 1)
    order.push(slug)
  }
  const statFor = (agent: string) => {
    let s = stats.get(agent)
    if (!s) {
      s = { agent, runs: 0, avgSeconds: 0, failed: 0, accept: 0, reject: 0, escalate: 0, totalSeconds: 0 }
      stats.set(agent, s)
    }
    return s
  }

  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    let e: Entry
    try {
      e = JSON.parse(line) as Entry
    } catch {
      continue
    }
    const slug = str(e.slug)
    if (!slug) continue
    const agent = str(e.agent)

    if (e.event === 'start' && agent) {
      jobs.set(slug, { slug, agent, status: 'running', startedTs: num(e.ts) })
      touch(slug)
    } else if (agent) {
      const prev = jobs.get(slug)
      const job: Job = {
        slug,
        agent,
        status: 'review',
        startedTs: prev?.startedTs,
        seconds: num(e.seconds),
        build: str(e.build),
        tests: str(e.tests),
        files: num(e.files),
        agentExit: num(e.agent_exit),
      }
      jobs.set(slug, job)
      touch(slug)
      const s = statFor(agent)
      s.runs += 1
      s.totalSeconds += job.seconds ?? 0
      if (job.build === 'FAIL' || job.tests === 'FAIL' || (job.agentExit ?? 0) !== 0) s.failed += 1
    } else {
      const verdict = VERDICTS.find(v => v === e.verdict)
      const job = jobs.get(slug)
      if (!verdict || !job) continue
      jobs.set(slug, { ...job, status: verdict, note: str(e.note) })
      touch(slug)
      statFor(job.agent)[verdict] += 1
    }
  }

  const list = order.map(slug => jobs.get(slug)).filter((j): j is Job => j !== undefined)
  return {
    jobs: list.reverse().slice(0, maxJobs),
    stats: [...stats.values()].map(({ totalSeconds, ...s }) => ({
      ...s,
      avgSeconds: s.runs ? Math.round(totalSeconds / s.runs) : 0,
    })),
  }
}

export function formatSeconds(total: number): string {
  if (total < 60) return `${total}s`
  return `${Math.floor(total / 60)}m ${String(total % 60).padStart(2, '0')}s`
}
