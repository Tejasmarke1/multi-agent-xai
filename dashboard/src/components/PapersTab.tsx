import { useState } from 'react'
import { PipelineState } from '../types'
import { formatDate, truncate } from '../lib/utils'
import { ExternalLink, FileText, Search, ChevronDown } from 'lucide-react'

interface PapersTabProps {
  state: PipelineState | null
}

export default function PapersTab({ state }: PapersTabProps) {
  const [search, setSearch] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)
  const [view, setView] = useState<'papers' | 'summaries'>('papers')

  if (!state) {
    return (
      <div className="flex items-center justify-center h-full min-h-[500px]">
        <div className="text-center space-y-4 max-w-md p-8 rounded-2xl glass-card border border-white/[0.07] shadow-2xl">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-indigo-500/20 via-blue-500/10 to-cyan-500/20 border border-cyan-500/30 flex items-center justify-center mx-auto text-cyan-300 shadow-inner">
            <FileText className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-slate-100 tracking-tight">No Papers Retrieved</h2>
            <p className="text-xs text-slate-400 mt-1.5 leading-relaxed">
              Launch the pipeline to fetch candidate literature from arXiv and OpenAlex repositories.
            </p>
          </div>
        </div>
      </div>
    )
  }

  const { papers, summaries } = state
  const summariesById = Object.fromEntries(summaries.map(s => [s.paper_id, s]))

  const filteredPapers = papers.filter(p =>
    search === '' ||
    p.title.toLowerCase().includes(search.toLowerCase()) ||
    p.abstract.toLowerCase().includes(search.toLowerCase()) ||
    p.authors.some(a => a.toLowerCase().includes(search.toLowerCase()))
  )

  return (
    <div className="p-6 space-y-5 max-w-5xl mx-auto">
      {/* Controls */}
      <div className="flex items-center gap-3 flex-wrap pb-2 border-b border-white/[0.06]">
        <div className="flex-1 relative min-w-48">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-cyan-400" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search papers by title, abstract keyword, or author…"
            className="w-full pl-10 pr-4 py-2 text-xs bg-slate-900/80 border border-slate-700/60 rounded-xl text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-cyan-500/50 focus:border-cyan-500 transition-all shadow-inner"
          />
        </div>

        <div className="flex rounded-xl bg-slate-900/80 p-1 border border-slate-700/60 shadow-inner text-xs">
          <button
            onClick={() => setView('papers')}
            className={`px-3 py-1.5 rounded-lg font-medium transition-all ${
              view === 'papers'
                ? 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-md shadow-indigo-950/40'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Papers ({papers.length})
          </button>
          <button
            onClick={() => setView('summaries')}
            className={`px-3 py-1.5 rounded-lg font-medium transition-all ${
              view === 'summaries'
                ? 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-md shadow-indigo-950/40'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Structured Summaries ({summaries.length})
          </button>
        </div>
      </div>

      {view === 'papers' ? (
        <div className="space-y-3">
          {filteredPapers.length === 0 && (
            <div className="glass-card border border-white/[0.07] rounded-2xl p-12 text-center">
              <Search className="w-8 h-8 text-slate-500 mx-auto mb-2" />
              <p className="text-sm text-slate-400">No papers matched your search query.</p>
            </div>
          )}
          {filteredPapers.map(paper => {
            const isExpanded = expanded === paper.paper_id
            const summary = summariesById[paper.paper_id]

            return (
              <div
                key={paper.paper_id}
                className={`glass-card border rounded-2xl overflow-hidden transition-all duration-200 ${
                  isExpanded ? 'border-cyan-500/40 shadow-xl shadow-cyan-950/20' : 'border-white/[0.07] hover:border-cyan-500/30'
                }`}
              >
                <div
                  className="flex items-start gap-3.5 p-4.5 cursor-pointer select-none"
                  onClick={() => setExpanded(isExpanded ? null : paper.paper_id)}
                >
                  <div className="w-9 h-9 rounded-xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center shrink-0 text-cyan-400 shadow-sm mt-0.5">
                    <FileText className="w-4 h-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-slate-100 text-sm leading-snug tracking-tight">{paper.title}</p>
                    <p className="text-xs text-slate-400 mt-1">
                      {paper.authors.slice(0, 4).join(', ')}
                      {paper.authors.length > 4 && ` +${paper.authors.length - 4} more`}
                    </p>
                    <div className="flex items-center gap-2.5 mt-2 text-xs">
                      {paper.published && (
                        <span className="text-slate-400 font-mono text-[11px] bg-slate-800/60 border border-white/[0.05] px-2 py-0.5 rounded-md">
                          {formatDate(paper.published)}
                        </span>
                      )}
                      {paper.citation_count != null && (
                        <span className="text-slate-300 font-mono text-[11px] bg-slate-800/60 border border-white/[0.05] px-2 py-0.5 rounded-md">
                          {paper.citation_count} citations
                        </span>
                      )}
                      {summary && (
                        <span className="text-[11px] font-mono text-emerald-300 bg-emerald-500/10 border border-emerald-500/30 px-2 py-0.5 rounded-md flex items-center gap-1">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                          Summarized
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0 pt-0.5">
                    {paper.url && (
                      <a
                        href={paper.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={e => e.stopPropagation()}
                        className="p-1.5 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-slate-400 hover:text-cyan-300 border border-white/[0.05] transition-colors"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                    )}
                    <ChevronDown
                      className={`w-4 h-4 text-slate-400 transition-transform ${isExpanded ? 'rotate-180 text-cyan-400' : ''}`}
                    />
                  </div>
                </div>

                {isExpanded && (
                  <div className="border-t border-white/[0.07] p-5 space-y-4 bg-slate-950/50">
                    {/* Abstract */}
                    <div>
                      <div className="text-[11px] font-mono uppercase tracking-wider text-slate-400 mb-2 flex items-center gap-1.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-cyan-400" />
                        Abstract Overview
                      </div>
                      <p className="text-xs text-slate-300 leading-relaxed bg-slate-900/60 p-3.5 rounded-xl border border-white/[0.05]">
                        {paper.abstract}
                      </p>
                    </div>

                    {/* Structured summary */}
                    {summary && (
                      <div>
                        <div className="text-[11px] font-mono uppercase tracking-wider text-slate-400 mb-2.5 flex items-center gap-1.5">
                          <span className="w-1.5 h-1.5 rounded-full bg-indigo-400" />
                          Structured Agent Extraction (LLM Grounded)
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
                          {[
                            { label: 'Problem Investigated', value: summary.problem, color: 'text-cyan-400' },
                            { label: 'Method / Architecture', value: summary.method, color: 'text-indigo-400' },
                            { label: 'Dataset & Benchmarks', value: summary.dataset, color: 'text-emerald-400' },
                            { label: 'Key Empirical Result', value: summary.key_result, color: 'text-amber-400' },
                            { label: 'Reported Limitations', value: summary.limitations, color: 'text-rose-400' },
                            { label: 'Claimed Contribution', value: summary.claimed_contribution, color: 'text-purple-400' },
                          ].map(({ label, value, color }) => (
                            <div key={label} className="bg-slate-900/80 rounded-xl p-3.5 border border-white/[0.06] space-y-1.5">
                              <div className={`text-[11px] font-mono font-semibold uppercase tracking-wider ${color}`}>
                                {label}
                              </div>
                              <p className="text-xs text-slate-300 leading-relaxed">{value || '—'}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      ) : (
        /* Summaries view as table */
        <div className="glass-card border border-white/[0.08] rounded-2xl overflow-hidden shadow-2xl">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-white/[0.07] bg-slate-900/80 backdrop-blur-md">
                  {['Paper ID', 'Problem', 'Method', 'Dataset', 'Key Result', 'Limitations'].map(h => (
                    <th key={h} className="text-left text-[11px] font-mono font-semibold text-slate-400 px-4 py-3 uppercase tracking-wider whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.04]">
                {summaries.map(s => (
                  <tr key={s.paper_id} className="hover:bg-slate-800/40 transition-colors">
                    <td className="px-4 py-3 text-cyan-400 font-mono text-[11px]">{s.paper_id.slice(0, 12)}…</td>
                    <td className="px-4 py-3 text-slate-200 max-w-xs">{truncate(s.problem, 80)}</td>
                    <td className="px-4 py-3 text-slate-200 max-w-xs">{truncate(s.method, 80)}</td>
                    <td className="px-4 py-3 text-slate-300">{truncate(s.dataset, 60)}</td>
                    <td className="px-4 py-3 text-slate-200 max-w-xs">{truncate(s.key_result, 80)}</td>
                    <td className="px-4 py-3 text-slate-300 max-w-xs">{truncate(s.limitations, 80)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
