import { PipelineState, JobStatus } from '../types'
import { cn } from '../lib/utils'
import { CheckCircle2, Circle, Loader2, ArrowRight } from 'lucide-react'

interface PipelineFlowProps {
  isRunning: boolean
  jobStatus: JobStatus | null
  state: PipelineState | null
}

interface NodeDef {
  id: string
  label: string
  sublabel: string
  color: string
  row: number
  col: number
  parallel?: boolean
}

const NODES: NodeDef[] = [
  { id: 'retrieve', label: 'Retrieve', sublabel: 'arXiv + OpenAlex', color: 'violet', row: 0, col: 2 },
  { id: 'parse', label: 'Parse', sublabel: 'PDF → text', color: 'violet', row: 1, col: 2 },
  { id: 'summarize', label: 'Summarize', sublabel: 'LLM extraction', color: 'violet', row: 2, col: 2 },
  { id: 'embed_and_cluster', label: 'Embed & Cluster', sublabel: 'SPECTER2 + k-NN', color: 'sky', row: 3, col: 0, parallel: true },
  { id: 'build_graph', label: 'Build Graph', sublabel: 'Problem/Method/Dataset', color: 'cyan', row: 3, col: 2, parallel: true },
  { id: 'detect_contradictions', label: 'Detect Contradictions', sublabel: 'NLI cross-encoder', color: 'orange', row: 3, col: 4, parallel: true },
  { id: 'critique', label: 'Critique', sublabel: 'Skeptical LLM reviewer', color: 'yellow', row: 4, col: 2 },
  { id: 'score', label: 'Score', sublabel: 'Weighted composite', color: 'emerald', row: 5, col: 2 },
  { id: 'explain', label: 'Explain (XAI)', sublabel: 'Evidence-grounded', color: 'emerald', row: 6, col: 2 },
]

const COLOR_MAP: Record<string, { bg: string; border: string; text: string; glow: string; activeBorder: string }> = {
  violet: { 
    bg: 'bg-violet-950/20', 
    border: 'border-violet-500/30', 
    text: 'text-violet-300', 
    glow: 'shadow-violet-950/40',
    activeBorder: 'border-violet-400 ring-violet-500/40 shadow-violet-500/30',
  },
  sky: { 
    bg: 'bg-sky-950/20', 
    border: 'border-sky-500/30', 
    text: 'text-sky-300', 
    glow: 'shadow-sky-950/40',
    activeBorder: 'border-sky-400 ring-sky-500/40 shadow-sky-500/30',
  },
  cyan: { 
    bg: 'bg-cyan-950/20', 
    border: 'border-cyan-500/30', 
    text: 'text-cyan-300', 
    glow: 'shadow-cyan-950/40',
    activeBorder: 'border-cyan-400 ring-cyan-500/40 shadow-cyan-500/30',
  },
  orange: { 
    bg: 'bg-amber-950/20', 
    border: 'border-amber-500/30', 
    text: 'text-amber-300', 
    glow: 'shadow-amber-950/40',
    activeBorder: 'border-amber-400 ring-amber-500/40 shadow-amber-500/30',
  },
  yellow: { 
    bg: 'bg-yellow-950/20', 
    border: 'border-yellow-500/30', 
    text: 'text-yellow-300', 
    glow: 'shadow-yellow-950/40',
    activeBorder: 'border-yellow-400 ring-yellow-500/40 shadow-yellow-500/30',
  },
  emerald: { 
    bg: 'bg-emerald-950/20', 
    border: 'border-emerald-500/30', 
    text: 'text-emerald-300', 
    glow: 'shadow-emerald-950/40',
    activeBorder: 'border-emerald-400 ring-emerald-500/40 shadow-emerald-500/30',
  },
}

// Determine which nodes are "done" based on state
function getNodeStatuses(state: PipelineState | null, isRunning: boolean): Record<string, 'done' | 'running' | 'idle'> {
  if (!state && !isRunning) return {}
  if (!state) return { retrieve: 'running' }

  const statuses: Record<string, 'done' | 'running' | 'idle'> = {}
  const log = state.log.join(' ').toLowerCase()

  const checks: [string, string][] = [
    ['retrieve', 'retrieved'],
    ['parse', 'parsed'],
    ['summarize', 'summarized'],
    ['embed_and_cluster', 'embedding-sparsity'],
    ['build_graph', 'knowledge-graph'],
    ['detect_contradictions', 'contradiction'],
    ['critique', 'critic agent'],
    ['score', 'scored and ranked'],
    ['explain', 'generated explanations'],
  ]

  for (const [id, keyword] of checks) {
    statuses[id] = log.includes(keyword) ? 'done' : (isRunning ? 'idle' : 'idle')
  }

  if (isRunning) {
    // Mark current running node
    const lastDone = checks.filter(([id]) => statuses[id] === 'done').at(-1)
    if (lastDone) {
      const nextIdx = checks.findIndex(([id]) => id === lastDone[0]) + 1
      if (nextIdx < checks.length) {
        statuses[checks[nextIdx][0]] = 'running'
      }
    } else {
      statuses['retrieve'] = 'running'
    }
  }

  return statuses
}

function PipelineNode({ node, status }: { node: NodeDef; status: 'done' | 'running' | 'idle' }) {
  const c = COLOR_MAP[node.color]
  return (
    <div
      className={cn(
        'relative flex flex-col items-center justify-center px-4 py-3 rounded-2xl border text-center transition-all duration-300 min-w-[150px] shadow-lg',
        status === 'done' && `${c.bg} border-emerald-500/50 shadow-emerald-950/30 shadow-[0_0_15px_rgba(16,185,129,0.15)]`,
        status === 'running' && `${c.bg} ${c.activeBorder} animate-pulse ring-2 ring-offset-2 ring-offset-slate-950 shadow-[0_0_20px_rgba(56,189,248,0.3)]`,
        status === 'idle' && 'bg-slate-900/60 border-white/[0.06] text-slate-500',
      )}
    >
      {/* Status icon badge */}
      <div className="absolute -top-2 -right-2">
        {status === 'done' && (
          <div className="w-5 h-5 rounded-full bg-slate-950 flex items-center justify-center border border-emerald-500/50 shadow-sm shadow-emerald-500/50">
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          </div>
        )}
        {status === 'running' && (
          <div className="w-5 h-5 rounded-full bg-slate-950 flex items-center justify-center border border-cyan-400 shadow-sm shadow-cyan-400/50">
            <Loader2 className="w-3.5 h-3.5 text-cyan-400 animate-spin" />
          </div>
        )}
        {status === 'idle' && (
          <Circle className="w-4 h-4 text-slate-700 bg-slate-950 rounded-full" />
        )}
      </div>

      <div className={cn('text-xs font-mono font-semibold tracking-tight', status !== 'idle' ? c.text : 'text-slate-400')}>
        {node.label}
      </div>
      <div className="text-[11px] text-slate-400 mt-0.5">{node.sublabel}</div>
    </div>
  )
}

export default function PipelineFlow({ isRunning, jobStatus, state }: PipelineFlowProps) {
  const statuses = getNodeStatuses(state, isRunning)

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between pb-2 border-b border-white/[0.06]">
        <div>
          <h2 className="text-base font-semibold text-slate-100 tracking-tight">LangGraph Multi-Agent Architecture</h2>
          <p className="text-xs text-slate-400 mt-1">
            Asynchronous multi-agent execution pipeline with parallel fan-out evidence triangulation
          </p>
        </div>
      </div>

      {/* Flow diagram canvas */}
      <div className="glass-card border border-white/[0.08] rounded-2xl p-8 shadow-2xl relative overflow-hidden">
        {/* Subtle background tech grid */}
        <div className="absolute inset-0 bg-[radial-gradient(#1e293b_1px,transparent_1px)] [background-size:20px_20px] opacity-40 pointer-events-none" />

        <div className="relative flex flex-col items-center gap-4">
          {/* Sequential nodes: retrieve → parse → summarize */}
          {['retrieve', 'parse', 'summarize'].map((id) => {
            const node = NODES.find(n => n.id === id)!
            return (
              <div key={id} className="flex flex-col items-center gap-2">
                <PipelineNode node={node} status={statuses[id] ?? 'idle'} />
                <ArrowRight className="w-4 h-4 text-slate-600 rotate-90" />
              </div>
            )
          })}

          {/* Fan-out label */}
          <div className="text-[11px] font-mono uppercase tracking-wider text-cyan-300 bg-cyan-950/40 px-3 py-1 rounded-full border border-cyan-500/30 shadow-inner">
            ⚡ Parallel Triangulation Fan-Out
          </div>

          {/* Parallel row */}
          <div className="flex items-start gap-4 w-full justify-center flex-wrap my-2">
            {['embed_and_cluster', 'build_graph', 'detect_contradictions'].map(id => {
              const node = NODES.find(n => n.id === id)!
              return (
                <div key={id} className="flex flex-col items-center gap-2">
                  <PipelineNode node={node} status={statuses[id] ?? 'idle'} />
                  <ArrowRight className="w-4 h-4 text-slate-600 rotate-90" />
                </div>
              )
            })}
          </div>

          {/* Fan-in label */}
          <div className="text-[11px] font-mono uppercase tracking-wider text-indigo-300 bg-indigo-950/40 px-3 py-1 rounded-full border border-indigo-500/30 shadow-inner">
            🔗 Fan-In Evidence Synthesis
          </div>

          {/* Final sequential: critique → score → explain */}
          {['critique', 'score', 'explain'].map((id, i) => {
            const node = NODES.find(n => n.id === id)!
            return (
              <div key={id} className="flex flex-col items-center gap-2">
                <PipelineNode node={node} status={statuses[id] ?? 'idle'} />
                {i < 2 && <ArrowRight className="w-4 h-4 text-slate-600 rotate-90" />}
              </div>
            )
          })}

          {/* End indicator */}
          {statuses['explain'] === 'done' && (
            <div className="flex flex-col items-center gap-2 pt-2 animate-fade-in">
              <ArrowRight className="w-4 h-4 text-emerald-400 rotate-90" />
              <div className="px-6 py-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/40 text-emerald-300 text-xs font-mono font-semibold shadow-lg shadow-emerald-950/30 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]" />
                PIPELINE COMPLETE · {state?.final_gaps.length ?? 0} Triangulated Gaps Ready
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Evidence layer explainer cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {[
          {
            emoji: '🔮',
            title: 'Embedding Sparsity',
            tag: 'SPECTER2 & k-NN',
            border: 'border-sky-500/30 hover:border-sky-500/50',
            bg: 'bg-sky-950/15',
            text: 'text-sky-300',
            desc: 'SPECTER2 embeds papers into vector space. k-NN density estimation identifies topically isolated, under-researched regions.',
          },
          {
            emoji: '🕸️',
            title: 'Knowledge Graph',
            tag: 'Topological Triples',
            border: 'border-cyan-500/30 hover:border-cyan-500/50',
            bg: 'bg-cyan-950/15',
            text: 'text-cyan-300',
            desc: 'Constructs a tripartite problem→method→dataset graph and queries for high-potential method-dataset combinations with zero co-occurrence.',
          },
          {
            emoji: '⚔️',
            title: 'Contradiction Audit',
            tag: 'DeBERTa-v3 NLI',
            border: 'border-amber-500/30 hover:border-amber-500/50',
            bg: 'bg-amber-950/15',
            text: 'text-amber-300',
            desc: 'Cross-encoder NLI model analyzes claim pairs addressing similar problems, surfacing active disputes and empirical contradictions.',
          },
        ].map(({ emoji, title, tag, border, bg, text, desc }) => {
          return (
            <div key={title} className={`glass-card rounded-2xl border p-4.5 ${bg} ${border} transition-all duration-200 shadow-xl space-y-2`}>
              <div className="flex items-center justify-between">
                <span className="text-xl">{emoji}</span>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-slate-900 border border-white/[0.08] text-slate-400">
                  {tag}
                </span>
              </div>
              <div className={`text-xs font-mono font-semibold ${text}`}>{title}</div>
              <p className="text-xs text-slate-400 leading-relaxed">{desc}</p>
            </div>
          )
        })}
      </div>

      {/* Active Job status footer */}
      {jobStatus && (
        <div className="glass-card border border-white/[0.08] rounded-2xl p-4 text-xs text-slate-400 flex items-center justify-between shadow-xl">
          <div className="flex items-center gap-2">
            <span className="font-mono text-slate-300 font-semibold uppercase tracking-wider">Execution Status:</span>
            <span className={cn(
              'font-mono font-semibold px-2 py-0.5 rounded-md text-[11px]',
              jobStatus.status === 'done' ? 'text-emerald-300 bg-emerald-500/15 border border-emerald-500/30' :
              jobStatus.status === 'error' ? 'text-rose-300 bg-rose-500/15 border border-rose-500/30' :
              'text-cyan-300 bg-cyan-500/15 border border-cyan-500/30 animate-pulse'
            )}>
              {jobStatus.status.toUpperCase()}
            </span>
          </div>
          {jobStatus.progress && (
            <span className="font-mono text-slate-400 text-[11px] truncate max-w-md">
              {jobStatus.progress}
            </span>
          )}
        </div>
      )}
    </div>
  )
}
