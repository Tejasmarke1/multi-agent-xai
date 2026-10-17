import { useRef, useEffect } from 'react'
import { PipelineState, JobStatus } from '../types'
import { Terminal, Download } from 'lucide-react'

interface LogTabProps {
  state: PipelineState | null
  jobStatus: JobStatus | null
}

export default function LogTab({ state, jobStatus }: LogTabProps) {
  const logEndRef = useRef<HTMLDivElement>(null)

  // Final log from completed state, or live incremental log while running
  const lines: string[] = state?.log ?? jobStatus?.log_live ?? []

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [lines.length])

  function downloadLog() {
    const blob = new Blob([lines.join('\n')], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `xai-pipeline-log-${Date.now()}.txt`
    a.click()
    URL.revokeObjectURL(url)
  }

  function parseLevel(line: string): 'info' | 'warn' | 'error' | 'success' {
    const l = line.toLowerCase()
    if (l.includes('error') || l.includes('failed')) return 'error'
    if (l.includes('warn')) return 'warn'
    if (l.includes('done') || l.includes('generated') || l.includes('passed') || l.includes('explained')) return 'success'
    return 'info'
  }

  const levelClass = {
    info: 'text-foreground',
    warn: 'text-yellow-400',
    error: 'text-red-400',
    success: 'text-emerald-400',
  }

  const levelPrefix = {
    info: '  ',
    warn: '⚠ ',
    error: '✗ ',
    success: '✓ ',
  }

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-5">
      <div className="flex items-center justify-between pb-2 border-b border-white/[0.06]">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center text-cyan-400">
            <Terminal className="w-4 h-4" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-slate-100 tracking-tight">Agent Execution Telemetry Log</h2>
            <p className="text-xs text-slate-400">Real-time trace of LangGraph agent invocations and LLM inferences</p>
          </div>
          {lines.length > 0 && (
            <span className="text-[11px] font-mono text-cyan-300 bg-cyan-500/10 border border-cyan-500/20 px-2 py-0.5 rounded-full ml-2">
              {lines.length} lines
            </span>
          )}
        </div>
        {lines.length > 0 && (
          <button
            onClick={downloadLog}
            className="flex items-center gap-1.5 text-xs text-slate-300 hover:text-cyan-300 border border-white/[0.08] bg-slate-900/80 hover:border-cyan-500/40 px-3 py-1.5 rounded-xl transition-all shadow-sm"
          >
            <Download className="w-3.5 h-3.5" />
            Export Log
          </button>
        )}
      </div>

      {lines.length === 0 && !jobStatus ? (
        <div className="glass-card border border-white/[0.08] rounded-2xl p-12 text-center shadow-xl">
          <Terminal className="w-10 h-10 text-slate-500 mx-auto mb-3" />
          <p className="text-sm text-slate-400">No telemetry log entries available yet. Launch the pipeline to view real-time traces.</p>
        </div>
      ) : (
        <div className="border border-white/[0.08] rounded-2xl bg-[#040711] shadow-2xl overflow-hidden font-mono">
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-white/[0.06] bg-slate-950/60">
            <div className="flex items-center gap-2">
              <div className="w-2.5 h-2.5 rounded-full bg-rose-500/80 shadow-[0_0_8px_rgba(244,63,94,0.6)]" />
              <div className="w-2.5 h-2.5 rounded-full bg-amber-500/80 shadow-[0_0_8px_rgba(245,158,11,0.6)]" />
              <div className="w-2.5 h-2.5 rounded-full bg-emerald-500/80 shadow-[0_0_8px_rgba(16,185,129,0.6)]" />
              <span className="text-[11px] font-mono text-slate-400 ml-2">xai-langgraph-orchestrator.log</span>
            </div>
            {jobStatus?.status === 'running' && (
              <span className="flex items-center gap-1.5 text-[11px] font-mono text-cyan-400">
                <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
                STREAM ACTIVE
              </span>
            )}
          </div>
          <div className="p-4 overflow-y-auto max-h-[60vh] space-y-1 text-xs">
            {lines.map((line, i) => {
              const level = parseLevel(line)
              return (
                <div key={i} className="flex gap-3 hover:bg-slate-900/40 py-0.5 px-1 rounded transition-colors">
                  <span className="text-slate-600 shrink-0 select-none w-7 text-right font-mono">
                    {i + 1}
                  </span>
                  <span className={`${levelClass[level]} break-all font-mono leading-relaxed`}>
                    <span className="text-slate-500 mr-1.5 select-none">{levelPrefix[level]}</span>
                    {line}
                  </span>
                </div>
              )
            })}

            {/* Live running stream indicator */}
            {jobStatus?.status === 'running' && (
              <div className="flex gap-3 py-1 px-1">
                <span className="text-slate-600 w-7 text-right font-mono">{lines.length + 1}</span>
                <span className="text-cyan-400 animate-pulse font-mono flex items-center gap-1">
                  <span>▌</span> {jobStatus.progress || 'Processing next agent stage...'}
                </span>
              </div>
            )}

            <div ref={logEndRef} />
          </div>
        </div>
      )}

      {/* Agent Legend */}
      <div className="glass-card border border-white/[0.08] rounded-2xl p-5 shadow-xl">
        <div className="text-[11px] font-mono font-semibold uppercase tracking-wider text-slate-400 mb-3 flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-cyan-400" />
          Agent Registry & Responsibilities
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          {[
            { agent: 'RetrieverAgent', desc: 'Fetches papers from arXiv + OpenAlex with query expansion' },
            { agent: 'ParserAgent', desc: 'Extracts full text and metadata from academic PDFs' },
            { agent: 'SummarizerAgent', desc: 'Structured schema extraction using Gemini 3.5' },
            { agent: 'EmbeddingSpaceAgent', desc: 'SPECTER2 document vectors + k-NN density estimation' },
            { agent: 'KnowledgeGraphAgent', desc: 'Problem → Method → Dataset bipartite graph construction' },
            { agent: 'ContradictionAgent', desc: 'DeBERTa-v3 cross-encoder NLI empirical contradiction audit' },
            { agent: 'GapDetectorAgent', desc: 'Triangulation engine fusing structural and semantic signals' },
            { agent: 'CriticAgent', desc: 'Adversarial peer reviewer scoring feasibility & novelty' },
            { agent: 'ExplainerAgent', desc: 'Synthesizes transparent XAI reasoning chains' },
          ].map(({ agent, desc }) => (
            <div key={agent} className="flex items-start gap-2 bg-slate-900/40 p-2.5 rounded-xl border border-white/[0.04]">
              <span className="text-cyan-300 font-mono text-[11px] font-semibold shrink-0">{agent}</span>
              <span className="text-slate-400 text-xs">— {desc}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
