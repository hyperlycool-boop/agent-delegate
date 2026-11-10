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
  model?: string
  effort?: string
  live?: string
  last?: string
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

export type ModelInfo = { slug: string; label: string }
export type CodexModel = ModelInfo & { efforts: string[] }

export type Catalog = {
  agyModels: ModelInfo[]
  agyEfforts: string[]
  codexModels: CodexModel[]
  loadedTs: number
}

export type DelegateView = {
  root: string
  logPath: string
  delegateHome: string
  jobs: Job[]
  stats: AgentStat[]
  error?: string
  updatedTs: number
}

export type ViewMode = 'result' | 'live'

// '' means "not set here": run.sh falls back to .delegate.json, then the agent default.
export type AgentChoice = { model: string; effort: string }

export type Controls = {
  mode: ViewMode
  selected: string
  agy: AgentChoice
  codex: AgentChoice
}

export type Output = { slug: string; mode: ViewMode; text: string }

export type WebState = { status: 'off' | 'starting' | 'on' | 'error'; url: string; message: string }

declare module 'claude-code' {
  interface PluginState {
    'delegate-panel': {
      view: Shaped<DelegateView | null>
      catalog: Shaped<Catalog | null>
      controls: Shaped<Controls>
      output: Shaped<Output | null>
      web: Shaped<WebState>
    }
  }
}
