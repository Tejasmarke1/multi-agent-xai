import { useState } from 'react'
import { PipelineState, CandidateGap } from '../types'
import { submitFeedback } from '../lib/api'
import { cn, getEvidenceColor, getEvidenceLabel, scoreGradient, formatScoreRaw } from '../lib/utils'
import { ChevronDown, ChevronUp, ExternalLink, ThumbsUp, ThumbsDown, AlertCircle, Filter } from 'lucide-react'

interface GapsTabProps {
  state: PipelineState | null
  isRunning: boolean
}

const EVIDENCE_FILTERS = ['all', 'embedding_sparsity', 'graph_missing_edge', 'contradiction', 'llm_synthesis'] as const

export default function GapsTab({ state, isRunning }: GapsTabProps) {
  const [expandedGap, setExpandedGap] = useState<string | null>(null)
  const [feedbackSent, setFeedbackSent] = useState<Record<string, 1 | 0>>({})
  const [filter, setFilter] = useState<string>('all')
  const [sortBy, setSortBy] = useState<'score' | 'density' | 'recency' | 'critic'>('score')

  if (isRunning) {
    return (
      <div className="flex items-center justify-center h-full min-h-[500px]">
        <div className="text-center space-y-4 max-w-sm p-8 rounded-2xl glass-card border border-cyan-500/20 shadow-2xl shadow-cyan-950/20">
          <div className="relative w-16 h-16 mx-auto">
            <div className="absolute inset-0 rounded-full border-2 border-cyan-500/20 animate-ping opacity-30" />
            <div className="w-16 h-16 border-2 border-cyan-500/20 border-t-cyan-400 rounded-full animate-spin" />
            <div className="absolute inset-0 flex items-center justify-center text-xs font-mono text-cyan-300">
              AI
            </div>
          </div>
          <div>
            <h3 className="text-sm font-semibold text-slate-100">Triangulating Research Gaps</h3>
            <p className="text-xs text-slate-400 mt-1">
              Executing multi-agent pipeline: arXiv retrieval, SPECTER2 embeddings, KG analysis & NLI verification...
            </p>
          </div>
        </div>
      </div>
    )
  }

  if (!state) {
    return (
      <div className="flex items-center justify-center h-full min-h-[500px]">
        <div className="text-center space-y-4 max-w-md p-8 rounded-2xl glass-card border border-white/[0.07] shadow-2xl">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-indigo-500/20 via-cyan-500/10 to-blue-500/20 border border-cyan-500/30 flex items-center justify-center mx-auto text-cyan-300 shadow-inner">
            <Filter className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-slate-100 tracking-tight">No Research Gaps Discovered Yet</h2>
            <p className="text-xs text-slate-400 mt-1.5 leading-relaxed">
              Enter your research domain or topic in the sidebar and trigger the <span className="text-cyan-300 font-medium">Run Pipeline</span> orchestrator.
            </p>
          </div>
        </div>
      </div>
    )
  }

  const gaps = [...state.final_gaps]
  const filtered = filter === 'all' ? gaps : gaps.filter(g => g.evidence_type === filter)
  const sorted = [...filtered].sort((a, b) => {
    if (sortBy === 'score') return b.final_score - a.final_score
    if (sortBy === 'density') return b.density_score - a.density_score
    if (sortBy === 'recency') return b.recency_score - a.recency_score
    if (sortBy === 'critic') return b.critic_score - a.critic_score
    return 0
  })

  const papersById = Object.fromEntries(state.papers.map(p => [p.paper_id, p]))

  async function handleFeedback(gap: CandidateGap, label: 0 | 1) {
    setFeedbackSent(f => ({ ...f, [gap.gap_id]: label }))
    try {
      await submitFeedback({
        gap_id: gap.gap_id,
        density_score: gap.density_score,
        recency_score: gap.recency_score,
        citation_velocity_score: gap.citation_velocity_score,
        critic_score: gap.critic_score,
        label,
      })
    } catch {
      // optimistic UI — ignore errors
    }
  }

  return (
    <div className="p-6 space-y-5 max-w-5xl mx-auto">
      {/* Header row */}
      <div className="flex items-center justify-between flex-wrap gap-4 pb-2 border-b border-white/[0.06]">
        <div>
          <div className="flex items-center gap-2.5">
            <h2 className="text-base font-semibold text-slate-100 tracking-tight">
              {sorted.length} Research Gap{sorted.length !== 1 ? 's' : ''} Identified
            </h2>
            <span className="text-[11px] font-mono px-2 py-0.5 rounded-full bg-cyan-500/10 text-cyan-300 border border-cyan-500/20">
              "{state.topic}"
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Synthesized via <span className="text-slate-300">k-NN embedding sparsity</span>, <span className="text-slate-300">knowledge graph missing edges</span> & <span className="text-slate-300">NLI contradictions</span>
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          {/* Evidence filter */}
          <div className="flex items-center gap-1.5 bg-slate-900/80 border border-slate-700/60 rounded-xl px-2.5 py-1 text-slate-300 shadow-inner">
            <Filter className="w-3.5 h-3.5 text-cyan-400" />
            <select
              value={filter}
              onChange={e => setFilter(e.target.value)}
              className="text-xs bg-transparent text-slate-200 focus:outline-none cursor-pointer"
            >
              <option value="all" className="bg-slate-900 text-slate-200">All evidence types</option>
              <option value="embedding_sparsity" className="bg-slate-900 text-slate-200">Embedding sparsity</option>
              <option value="graph_missing_edge" className="bg-slate-900 text-slate-200">Knowledge graph</option>
              <option value="contradiction" className="bg-slate-900 text-slate-200">Contradictions</option>
              <option value="llm_synthesis" className="bg-slate-900 text-slate-200">LLM synthesis</option>
            </select>
          </div>

          {/* Sort */}
          <div className="bg-slate-900/80 border border-slate-700/60 rounded-xl px-2.5 py-1 text-slate-300 shadow-inner">
            <select
              value={sortBy}
              onChange={e => setSortBy(e.target.value as typeof sortBy)}
              className="text-xs bg-transparent text-slate-200 focus:outline-none cursor-pointer"
            >
              <option value="score" className="bg-slate-900 text-slate-200">Sort: Final Score</option>
              <option value="density" className="bg-slate-900 text-slate-200">Sort: Density</option>
              <option value="recency" className="bg-slate-900 text-slate-200">Sort: Recency</option>
              <option value="critic" className="bg-slate-900 text-slate-200">Sort: Critic Conf.</option>
            </select>
          </div>
        </div>
      </div>

      {sorted.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 space-y-3 glass-card rounded-2xl border border-white/[0.06]">
          <AlertCircle className="w-10 h-10 text-slate-500" />
          <p className="text-sm text-slate-400">No gaps matched the selected filter criteria.</p>
        </div>
      )}

      {sorted.map((gap, idx) => {
        const isExpanded = expandedGap === gap.gap_id
        const fb = feedbackSent[gap.gap_id]
        const relatedPapers = gap.related_paper_ids.map(pid => papersById[pid]).filter(Boolean)

        return (
          <div
            key={gap.gap_id}
            className={cn(
              "glass-card border rounded-2xl overflow-hidden transition-all duration-300",
              isExpanded 
                ? "border-cyan-500/40 shadow-xl shadow-cyan-950/20 bg-slate-900/80" 
                : "border-white/[0.08] hover:border-cyan-500/30 hover:shadow-lg hover:shadow-black/40"
            )}
          >
            {/* Header */}
            <div
              className="flex items-start gap-4 p-5 cursor-pointer select-none"
              onClick={() => setExpandedGap(isExpanded ? null : gap.gap_id)}
            >
              {/* Rank badge */}
              <div className="shrink-0 w-8 h-8 rounded-xl bg-slate-800/90 border border-white/[0.08] flex items-center justify-center text-xs font-mono font-bold text-cyan-300 shadow-sm">
                #{String(idx + 1).padStart(2, '0')}
              </div>

              <div className="flex-1 min-w-0 space-y-2.5">
                <p className="font-medium text-slate-100 text-sm leading-relaxed tracking-tight">
                  {gap.description}
                </p>
                <div className="flex items-center flex-wrap gap-2 text-xs">
                  <span className={cn('text-[11px] px-2.5 py-0.5 rounded-full border font-medium uppercase tracking-wider', getEvidenceColor(gap.evidence_type))}>
                    {getEvidenceLabel(gap.evidence_type)}
                  </span>
                  {gap.critic_verdict && (
                    <span className="text-[11px] font-mono text-amber-300/90 bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 rounded-md">
                      Critic: {gap.critic_verdict}
                    </span>
                  )}
                  <span className="text-[11px] text-slate-400 bg-slate-800/60 border border-white/[0.05] px-2 py-0.5 rounded-md">
                    {relatedPapers.length} paper{relatedPapers.length !== 1 ? 's' : ''} cited
                  </span>
                </div>
              </div>

              {/* Score HUD Display */}
              <div className="shrink-0 text-right space-y-1 pl-2">
                <div className={cn('text-2xl font-bold font-mono tracking-tight', scoreGradient(gap.final_score))}>
                  {(gap.final_score * 100).toFixed(0)}
                  <span className="text-xs font-normal text-slate-500 ml-0.5">/100</span>
                </div>
                {/* Glowing Progress bar */}
                <div className="w-20 h-1.5 bg-slate-800 rounded-full overflow-hidden p-[1px] border border-white/[0.05]">
                  <div
                    className="h-full score-bar rounded-full"
                    style={{ width: `${gap.final_score * 100}%` }}
                  />
                </div>
              </div>

              <div className="shrink-0 text-slate-400 hover:text-slate-200 transition-colors pt-1">
                {isExpanded ? <ChevronUp className="w-4 h-4 text-cyan-400" /> : <ChevronDown className="w-4 h-4" />}
              </div>
            </div>

            {/* Expanded content */}
            {isExpanded && (
              <div className="border-t border-white/[0.08] px-5 pb-5 pt-4 space-y-5 bg-slate-950/40">
                {/* Score breakdown HUD */}
                <div>
                  <div className="text-[11px] font-mono uppercase tracking-wider text-slate-400 mb-2.5 flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-cyan-400" />
                    Multi-Factor Score Telemetry
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                    {[
                      { label: 'Density Gap', value: gap.density_score, desc: 'k-NN local sparsity signal' },
                      { label: 'Recency Weight', value: gap.recency_score, desc: 'Exponential time decay' },
                      { label: 'Citation Velocity', value: gap.citation_velocity_score, desc: 'Growth rate per year' },
                      { label: 'Critic Confidence', value: gap.critic_score, desc: 'Skeptical LLM evaluation' },
                    ].map(({ label, value, desc }) => (
                      <div key={label} className="bg-slate-900/70 rounded-xl p-3 border border-white/[0.06] hover:border-white/[0.12] transition-colors">
                        <div className="text-[11px] text-slate-400 font-medium mb-1">{label}</div>
                        <div className={cn('text-lg font-bold font-mono', scoreGradient(value))}>
                          {formatScoreRaw(value)}
                        </div>
                        <div className="w-full h-1 bg-slate-800 rounded-full mt-2 overflow-hidden">
                          <div className="h-full score-bar rounded-full" style={{ width: `${value * 100}%` }} />
                        </div>
                        <div className="text-[10px] text-slate-500 mt-1.5 truncate">{desc}</div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* XAI Explanation */}
                {gap.explanation && (
                  <div>
                    <div className="text-[11px] font-mono uppercase tracking-wider text-slate-400 mb-2 flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-indigo-400" />
                      XAI Evidence-Grounded Explanation
                    </div>
                    <div className="text-xs text-slate-300 bg-slate-950/80 rounded-xl p-4 border-l-2 border-l-cyan-400 border border-white/[0.06] leading-relaxed font-sans shadow-inner">
                      {gap.explanation}
                    </div>
                  </div>
                )}

                {/* Supporting papers */}
                {relatedPapers.length > 0 && (
                  <div>
                    <div className="text-[11px] font-mono uppercase tracking-wider text-slate-400 mb-2 flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-blue-400" />
                      Supporting Literature ({relatedPapers.length})
                    </div>
                    <div className="space-y-2">
                      {relatedPapers.map(paper => (
                        <div key={paper.paper_id} className="flex items-start gap-3 p-3 bg-slate-900/50 hover:bg-slate-900/80 rounded-xl border border-white/[0.05] hover:border-white/[0.1] transition-all">
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-semibold text-slate-200 truncate">{paper.title}</p>
                            <p className="text-[11px] text-slate-400 mt-0.5">
                              {paper.authors.slice(0, 3).join(', ')}
                              {paper.authors.length > 3 && ` +${paper.authors.length - 3}`}
                              {paper.published && ` · ${paper.published.slice(0, 4)}`}
                              {paper.citation_count != null && ` · ${paper.citation_count} citations`}
                            </p>
                          </div>
                          {paper.url && (
                            <a
                              href={paper.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="shrink-0 p-1.5 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-slate-400 hover:text-cyan-300 border border-white/[0.05] transition-colors"
                              onClick={e => e.stopPropagation()}
                            >
                              <ExternalLink className="w-3.5 h-3.5" />
                            </a>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Human-in-the-Loop Feedback */}
                <div className="flex items-center gap-3 pt-3 border-t border-white/[0.06]">
                  <span className="text-xs text-slate-400">Calibrate model: Is this gap novel & valid?</span>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleFeedback(gap, 1)}
                      disabled={fb !== undefined}
                      className={cn(
                        'flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium transition-all shadow-sm',
                        fb === 1
                          ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/50 shadow-emerald-950/30'
                          : 'bg-slate-900/80 border border-white/[0.08] hover:border-emerald-500/40 text-slate-300 hover:text-emerald-300'
                      )}
                    >
                      <ThumbsUp className="w-3.5 h-3.5" />
                      Valid Gap
                    </button>
                    <button
                      onClick={() => handleFeedback(gap, 0)}
                      disabled={fb !== undefined}
                      className={cn(
                        'flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium transition-all shadow-sm',
                        fb === 0
                          ? 'bg-rose-500/20 text-rose-300 border border-rose-500/50 shadow-rose-950/30'
                          : 'bg-slate-900/80 border border-white/[0.08] hover:border-rose-500/40 text-slate-300 hover:text-rose-300'
                      )}
                    >
                      <ThumbsDown className="w-3.5 h-3.5" />
                      Invalid / Noisy
                    </button>
                  </div>
                  {fb !== undefined && (
                    <span className="text-xs font-mono text-cyan-400 bg-cyan-950/40 px-2 py-0.5 rounded-md border border-cyan-500/20 animate-fade-in">
                      Feedback logged for calibration ✓
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
