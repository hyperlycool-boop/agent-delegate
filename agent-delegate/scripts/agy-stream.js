// Reads agy's --output-format stream-json from stdin.
// Writes one readable line per event to the live file, and the final answer to the result file.
// Usage: agy ... --output-format stream-json | node agy-stream.js <live-file> <result-file>
const fs = require('fs')
const readline = require('readline')

const [livePath, resultPath] = process.argv.slice(2)
const MAX_PARAM = 160

const live = line => fs.appendFileSync(livePath, line + '\n')
const brief = obj => {
  const s = JSON.stringify(obj ?? {})
  return s.length > MAX_PARAM ? s.slice(0, MAX_PARAM) + '…' : s
}
const secs = d => (typeof d === 'number' ? ` (${d.toFixed(1)}s)` : '')

let gotResult = false
const rl = readline.createInterface({ input: process.stdin })
rl.on('line', raw => {
  let e
  try {
    e = JSON.parse(raw)
  } catch {
    if (raw.trim()) live(raw)
    return
  }
  if (e.event === 'init') return live(`start  ${e.init?.cwd ?? ''}`)
  if (e.event === 'step_update') {
    const s = e.step_update ?? {}
    if (s.step_type === 'tool') {
      const name = s.tool_name ?? s.tool_info?.name ?? 'tool'
      if (s.state === 'ACTIVE') return live(`>      ${name} ${brief(s.tool_info?.parameters)}`)
      if (s.state === 'DONE') return live(`ok     ${name}${secs(s.duration_seconds)}`)
      if (s.state === 'ERROR') {
        const msg = String(s.tool_info?.error?.message ?? 'error').split('\n')[0]
        return live(`x      ${name}: ${msg}`)
      }
      return
    }
    if (s.step_type === 'agent_response' && s.state === 'DONE') {
      const out = s.usage?.output_tokens
      return live(`think  step ${s.step_index}${secs(s.duration_seconds)}${out ? `, ${out} tokens out` : ''}`)
    }
    return
  }
  if (e.event === 'result') {
    gotResult = true
    const r = e.result ?? {}
    live(`done   ${r.status ?? ''}${secs(r.duration_seconds)}`)
    fs.writeFileSync(resultPath, r.response ?? '')
  }
})
rl.on('close', () => {
  if (!gotResult) live('done   (no result event)')
})
