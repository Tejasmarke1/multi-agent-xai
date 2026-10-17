import { useState } from 'react'
import { PipelineState, JobStatus } from '../types'
import { calibrateWeights, getFeedbackCount } from '../lib/api'
import { cn, scoreGradient } from '../lib/utils'
import {
  Play, Sun, Moon, Sliders, BarChart3, Zap, BookOpen, Brain
} from 'lucide-react'

interface SidebarProps {
  onRun: (topic: string, maxResults: number) => void
  isRunning: boolean
  jobStatus: JobStatus | null
  state: PipelineState | null
  darkMode: boolean
  onToggleDark: () => void
}

const SAMPLE_TOPICS = [
  'explainable AI for code energy consumption',
  'federated learning privacy attacks',
  'vision transformers medical imaging',
  'causal reasoning large language models',
  'graph neural networks drug discovery',
]

export default function Sidebar({
  onRun, isRunning, jobStatus, state, darkMode, onToggleDark
}: SidebarProps) {
  const [topic, setTopic] = useState('explainable AI for code energy consumption')
  const [maxResults, setMaxResults] = useState(30)
  const [calStatus, setCalStatus] = useState<string | null>(null)
  const [calLoading, setCalLoading] = useState(false)
  const [feedbackCount, setFeedbackCount] = useState<number | null>(null)

  async function handleCalibrate() {
    setCalLoading(true)
    setCalStatus(null)
    try {
      const cnt = await getFeedbackCount()
      setFeedbackCount(cnt.count)
      if (cnt.count < 10) {
        setCalStatus(`Need ${10 - cnt.count} more feedback rows (have ${cnt.count}).`)
        setCalLoading(false)
        return
      }
      const weights = await calibrateWeights()
      setCalStatus(
        `✅ New weights: density=${weights.weight_density.toFixed(2)}, ` +
        `recency=${weights.weight_recency.toFixed(2)}, ` +
        `citation=${weights.weight_citation_velocity.toFixed(2)}, ` +
        `critic=${weights.weight_critic.toFixed(2)}`
      )
    } catch {
      setCalStatus('⚠️ Calibration failed. Ensure API is running.')
    }
    setCalLoading(false)
  }

  const statsItems = state
    ? [
        { label: 'Papers', value: state.papers.length, icon: BookOpen },
        { label: 'Raw gaps', value: state.raw_gaps.length, icon: Zap },
        { label: 'Final gaps', value: state.final_gaps.length, icon: Brain },
        { label: 'Contradictions', value: state.contradictions.length, icon: BarChart3 },
      ]
    : []

  return (
    <aside className="w-72 shrink-0 border-r border-border/80 bg-card/80 backdrop-blur-2xl flex flex-col overflow-y-auto z-20 shadow-xl shadow-black/40">
      {/* Brand Header */}
      <div className="p-4.5 border-b border-border/70 bg-gradient-to-b from-white/[0.02] to-transparent">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-white shadow-md shadow-indigo-500/20 ring-1 ring-white/20">
              <Brain className="w-5 h-5 text-white" />
            </div>
            <div>
              <div className="text-sm font-bold text-foreground leading-tight tracking-tight flex items-center gap-1.5">
                XAI Detector
                <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
              </div>
              <div className="text-[10px] uppercase font-mono tracking-wider text-muted-foreground/80">Multi-Agent Engine</div>
            </div>
          </div>
          <button
            onClick={onToggleDark}
            title={darkMode ? "Switch to light mode" : "Switch to dark mode"}
            className="p-1.5 rounded-lg bg-muted/40 hover:bg-muted text-muted-foreground hover:text-foreground border border-border/60 transition-colors"
          >
            {darkMode ? <Sun className="w-3.5 h-3.5 text-amber-400" /> : <Moon className="w-3.5 h-3.5 text-blue-400" />}
          </button>
        </div>
      </div>

      {/* Run settings */}
      <div className="p-4 space-y-4 border-b border-border/70">
        <div>
          <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5 flex items-center justify-between">
            <span>Research Topic</span>
            <span className="text-[10px] font-normal text-muted-foreground/70">arXiv / OpenAlex</span>
          </label>
          <textarea
            value={topic}
            onChange={e => setTopic(e.target.value)}
            rows={3}
            placeholder="e.g. explainable AI for code energy consumption"
            className="w-full text-xs font-medium bg-black/40 border border-white/[0.09] rounded-xl px-3 py-2.5 text-foreground placeholder:text-muted-foreground/60 resize-none focus:outline-none focus:ring-1 focus:ring-cyan-500/50 focus:border-cyan-500/50 transition-all shadow-inner"
          />
        </div>

        {/* Sample topics */}
        <div>
          <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-2 block">
            Suggested Prompts
          </label>
          <div className="flex flex-col gap-1">
            {SAMPLE_TOPICS.map(t => (
              <button
                key={t}
                onClick={() => setTopic(t)}
                className={cn(
                  'text-left text-[11px] px-2.5 py-1.5 rounded-lg transition-all truncate border',
                  topic === t
                    ? 'bg-primary/20 text-primary-foreground border-primary/40 font-medium shadow-sm shadow-primary/10'
                    : 'text-muted-foreground border-transparent hover:border-white/[0.06] hover:bg-white/[0.03] hover:text-foreground'
                )}
              >
                {t}
              </button>
            ))}
          </div>
        </div>

        {/* Max results slider */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
            <span>Retrieval Limit</span>
            <span className="text-cyan-400 font-mono font-bold">{maxResults} papers</span>
          </div>
          <input
            type="range"
            min={10}
            max={60}
            step={5}
            value={maxResults}
            onChange={e => setMaxResults(Number(e.target.value))}
            className="w-full accent-cyan-400 h-1.5 bg-black/40 rounded-lg cursor-pointer appearance-none border border-white/[0.05]"
          />
          <div className="flex justify-between text-[10px] font-mono text-muted-foreground/60">
            <span>10</span>
            <span>35</span>
            <span>60</span>
          </div>
        </div>

        {/* Run button */}
        <button
          onClick={() => onRun(topic.trim(), maxResults)}
          disabled={isRunning || !topic.trim()}
          className={cn(
            'w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-xs font-semibold tracking-wide transition-all duration-300 relative overflow-hidden',
            isRunning || !topic.trim()
              ? 'bg-muted/40 text-muted-foreground cursor-not-allowed border border-white/[0.05]'
              : 'bg-gradient-to-r from-blue-600 via-indigo-600 to-cyan-600 hover:from-blue-500 hover:via-indigo-500 hover:to-cyan-500 text-white shadow-lg shadow-indigo-600/25 hover:shadow-indigo-600/40 border border-white/20'
          )}
        >
          {isRunning ? (
            <>
              <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              <span>Analyzing Literature…</span>
            </>
          ) : (
            <>
              <Play className="w-3.5 h-3.5 fill-current" />
              <span>Launch Pipeline</span>
            </>
          )}
        </button>

        {/* Live Progress */}
        {(isRunning || jobStatus) && (
          <div className="space-y-1.5 pt-1">
            <div className={cn(
              'text-xs rounded-xl p-2.5 border flex items-start gap-2.5 backdrop-blur-md',
              jobStatus?.status === 'error'
                ? 'bg-destructive/15 border-destructive/30 text-red-300'
                : jobStatus?.status === 'done'
                ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300 shadow-sm shadow-emerald-500/10'
                : 'bg-black/40 border-cyan-500/25 text-cyan-200'
            )}>
              {isRunning && (
                <div className="w-2 h-2 rounded-full bg-cyan-400 animate-ping mt-1 shrink-0" />
              )}
              <div className="min-w-0">
                <div className="font-mono text-[11px] leading-tight break-words">
                  {jobStatus?.progress ?? 'Connecting to agents…'}
                </div>
              </div>
            </div>
            {isRunning && (
              <p className="text-[10px] text-muted-foreground/60 px-1 font-mono">
                Running 3 evidence branches in parallel via LangGraph
              </p>
            )}
          </div>
        )}
      </div>

      {/* Live Pipeline Stats */}
      {state && (
        <div className="p-4 border-b border-border/70 space-y-3">
          <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider block">
            Corpus Telemetry
          </label>
          <div className="grid grid-cols-2 gap-2">
            {statsItems.map(({ label, value, icon: Icon }) => (
              <div key={label} className="bg-black/30 rounded-xl p-2.5 border border-white/[0.07] hover:border-white/[0.12] transition-colors">
                <div className="flex items-center gap-1.5 text-muted-foreground/80 mb-1">
                  <Icon className="w-3 h-3 text-cyan-400" />
                  <span className="text-[10px] uppercase font-mono">{label}</span>
                </div>
                <div className="text-lg font-bold text-foreground font-mono">{value}</div>
              </div>
            ))}
          </div>

          {/* Top gap score highlight */}
          {state.final_gaps.length > 0 && (
            <div className="bg-gradient-to-br from-indigo-950/40 to-slate-900/60 rounded-xl p-3 border border-indigo-500/30 shadow-md shadow-indigo-950/40">
              <div className="text-[10px] font-semibold text-indigo-300 uppercase tracking-wider mb-1 flex items-center justify-between">
                <span>Top Ranked Gap</span>
                <span className="text-[10px] font-mono text-cyan-400">#1</span>
              </div>
              <div className={cn('text-2xl font-bold font-mono tracking-tight', scoreGradient(state.final_gaps[0].final_score))}>
                {(state.final_gaps[0].final_score * 100).toFixed(0)}
                <span className="text-xs font-normal text-muted-foreground font-sans ml-1">/ 100</span>
              </div>
              <div className="text-xs text-muted-foreground/90 mt-1 line-clamp-2 leading-relaxed">
                {state.final_gaps[0].description}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Human-in-the-Loop Calibration */}
      <div className="p-4 mt-auto border-t border-border/70 bg-black/20">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
            <Sliders className="w-3.5 h-3.5 text-cyan-400" />
            <span>XAI Calibration</span>
          </div>
          {feedbackCount !== null && (
            <span className="text-[10px] font-mono font-medium px-1.5 py-0.5 rounded bg-muted text-cyan-400 border border-white/[0.06]">
              {feedbackCount}/10 rows
            </span>
          )}
        </div>
        <p className="text-[11px] text-muted-foreground/80 mb-2.5 leading-relaxed">
          Rate detected gaps with 👍/👎 to recalibrate scoring weights with logistic regression.
        </p>
        <button
          onClick={handleCalibrate}
          disabled={calLoading}
          className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-xl text-xs font-medium border border-white/[0.09] bg-white/[0.03] hover:bg-white/[0.06] text-foreground transition-all duration-200 disabled:opacity-40"
        >
          {calLoading ? (
            <div className="w-3 h-3 border border-muted-foreground/30 border-t-muted-foreground rounded-full animate-spin" />
          ) : (
            <Sliders className="w-3 h-3 text-cyan-400" />
          )}
          <span>Recalibrate Weights</span>
        </button>
        {calStatus && (
          <p className="text-[10px] text-muted-foreground mt-2 p-2 bg-black/40 rounded-lg border border-white/[0.07] font-mono leading-relaxed">
            {calStatus}
          </p>
        )}
      </div>
    </aside>
  )
}
