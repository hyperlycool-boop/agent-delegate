export type JobStatus = 'running' | 'review' | 'accept' | 'reject' | 'escalate'

export type Job = {
  slug: string
  agent: string
  status: JobStatus
  startedTs?: number
  seconds?: number
  build?: string
  tests?: string
  files?: number
  agentExit?: number
  note?: string
}

export type AgentStat = {
  agent: string
  runs: number
  avgSeconds: number
  failed: number
  accept: number
  reject: number
  escalate: number
}

export type DelegateView = {
  root: string
  logPath: string
  jobs: Job[]
  stats: AgentStat[]
  error?: string
  updatedTs: number
}

declare module 'claude-code' {
  interface PluginState {
    'delegate-panel': { view: Shaped<DelegateView | null> }
  }
}
