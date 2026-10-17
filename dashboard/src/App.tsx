import { useState, useEffect, useRef } from 'react'
import { PipelineState, JobStatus } from './types'
import { runPipeline, getJobStatus } from './lib/api'
import Sidebar from './components/Sidebar'
import GapsTab from './components/GapsTab'
import GraphTab from './components/GraphTab'
import PapersTab from './components/PapersTab'
import LogTab from './components/LogTab'
import PipelineFlow from './components/PipelineFlow'
import { cn } from './lib/utils'
import { Microscope, Network, FileText, Terminal, GitBranch } from 'lucide-react'

type TabId = 'gaps' | 'graph' | 'papers' | 'log' | 'pipeline'

const TABS: { id: TabId; label: string; icon: React.ReactNode }[] = [
  { id: 'gaps', label: 'Research Gaps', icon: <Microscope className="w-4 h-4" /> },
  { id: 'graph', label: 'Knowledge Graph', icon: <Network className="w-4 h-4" /> },
  { id: 'papers', label: 'Papers', icon: <FileText className="w-4 h-4" /> },
  { id: 'log', label: 'Pipeline Log', icon: <Terminal className="w-4 h-4" /> },
  { id: 'pipeline', label: 'Architecture', icon: <GitBranch className="w-4 h-4" /> },
]

// Exponential-backoff constants
// Pipeline steps (arXiv fetch, model load, LLM calls) take 10–60 s each
// so rapid polling just floods logs without benefit.
const POLL_INITIAL_MS  = 3_000   // first check after 3 s
const POLL_MULTIPLIER  = 1.6     // grow each step
const POLL_MAX_MS      = 15_000  // cap at 15 s

export default function App() {
  const [activeTab, setActiveTab] = useState<TabId>('gaps')
  const [state, setState] = useState<PipelineState | null>(null)
  const [jobId, setJobId] = useState<string | null>(null)
  const [jobStatus, setJobStatus] = useState<JobStatus | null>(null)
  const [isRunning, setIsRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [darkMode, setDarkMode] = useState(true)

  // Use a ref for the timer so cleanup is always current
  const pollTimerRef   = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pollIntervalMs = useRef<number>(POLL_INITIAL_MS)

  // ---------- exponential-backoff polling ----------
  useEffect(() => {
    if (!jobId || !isRunning) return

    pollIntervalMs.current = POLL_INITIAL_MS

    let cancelled = false

    async function poll() {
      if (cancelled) return
      try {
        const status = await getJobStatus(jobId!)
        if (cancelled) return

        setJobStatus(status)

        if (status.status === 'done') {
          setState(status.result)
          setIsRunning(false)
          setActiveTab('gaps')
          return  // done — stop scheduling
        }

        if (status.status === 'error') {
          setError(status.error ?? 'Pipeline error — check API logs for details.')
          setIsRunning(false)
          return  // done — stop scheduling
        }
      } catch {
        // transient network error — keep polling
      }

      // Schedule next poll with backoff
      pollIntervalMs.current = Math.min(
        pollIntervalMs.current * POLL_MULTIPLIER,
        POLL_MAX_MS
      )
      pollTimerRef.current = setTimeout(poll, pollIntervalMs.current)
    }

    // Kick off first poll
    pollTimerRef.current = setTimeout(poll, pollIntervalMs.current)

    return () => {
      cancelled = true
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current)
    }
  }, [jobId, isRunning])

  // ---------- dark mode ----------
  useEffect(() => {
    document.documentElement.classList.toggle('light', !darkMode)
    document.documentElement.classList.toggle('dark', darkMode)
  }, [darkMode])

  // ---------- launch ----------
  async function handleRun(topic: string, maxResults: number) {
    if (pollTimerRef.current) clearTimeout(pollTimerRef.current)
    setError(null)
    setState(null)
    setJobStatus(null)
    setIsRunning(true)
    pollIntervalMs.current = POLL_INITIAL_MS
    setActiveTab('pipeline')
    try {
      const { job_id } = await runPipeline(topic, maxResults)
      setJobId(job_id)
    } catch {
      setError('Failed to connect to the API. Is the backend running on port 8000?')
      setIsRunning(false)
    }
  }

  return (
    <div className={cn('flex h-screen overflow-hidden relative font-sans', darkMode ? 'dark' : 'light')}>
      {/* Background ambient lighting */}
      <div className="absolute inset-0 pointer-events-none ambient-glow z-0" />
      <div className="absolute inset-0 pointer-events-none subtle-grid opacity-40 z-0" />

      {/* Sidebar */}
      <div className="relative z-10">
        <Sidebar
          onRun={handleRun}
          isRunning={isRunning}
          jobStatus={jobStatus}
          state={state}
          darkMode={darkMode}
          onToggleDark={() => setDarkMode(d => !d)}
        />
      </div>

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden relative z-10 bg-background/50 backdrop-blur-[2px]">
        {/* Top Header */}
        <header className="border-b border-border/70 bg-card/60 backdrop-blur-xl px-7 py-3.5 flex items-center justify-between gap-4 shrink-0 shadow-sm shadow-black/20">
          <div className="flex items-center gap-3 min-w-0">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h1 className="text-base font-bold text-foreground tracking-tight flex items-center gap-2">
                  <span className="inline-block w-2 h-2 rounded-full bg-emerald-400 shadow-sm shadow-emerald-400/80 animate-pulse" />
                  Multi-Agent XAI Gap Detector
                </h1>
                <span className="text-[10px] font-semibold tracking-wider uppercase px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20">
                  LangGraph v0.2
                </span>
                <span className="text-[10px] font-semibold tracking-wider uppercase px-2 py-0.5 rounded-full bg-violet-500/10 text-violet-300 border border-violet-500/20 hidden sm:inline-block">
                  Gemini 3.5 Flash
                </span>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5 truncate">
                {state
                  ? `${state.final_gaps.length} candidate gaps · ${state.papers.length} retrieved papers · topic: "${state.topic}"`
                  : 'Grounded Triangulation: Embedding Sparsity · Knowledge Graph · Contradiction NLI'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            {isRunning && (
              <div className="flex items-center gap-2 text-xs font-medium px-3 py-1.5 rounded-full bg-primary/10 border border-primary/30 text-primary shadow-sm shadow-primary/20">
                <div className="w-2 h-2 rounded-full bg-primary animate-ping" />
                <span className="animate-pulse font-mono truncate max-w-xs">
                  {jobStatus?.progress ?? 'Pipeline executing…'}
                </span>
              </div>
            )}
            {error && (
              <div className="text-destructive text-xs bg-destructive/10 px-3 py-1.5 rounded-lg border border-destructive/30 max-w-sm truncate shadow-sm shadow-destructive/10">
                ⚠️ {error}
              </div>
            )}
          </div>
        </header>

        {/* Segmented Tab Navigation */}
        <div className="border-b border-border/70 bg-card/40 backdrop-blur-md px-6 py-1.5 shrink-0">
          <nav className="flex gap-1.5">
            {TABS.map(tab => {
              const active = activeTab === tab.id
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={cn(
                    'flex items-center gap-2 px-3.5 py-2 text-xs font-medium rounded-lg transition-all duration-200 relative',
                    active
                      ? 'bg-primary/15 text-primary border border-primary/30 shadow-md shadow-primary/10 font-semibold'
                      : 'text-muted-foreground hover:text-foreground hover:bg-muted/50 border border-transparent'
                  )}
                >
                  <span className={cn('transition-colors', active ? 'text-primary' : 'text-muted-foreground')}>
                    {tab.icon}
                  </span>
                  <span>{tab.label}</span>
                  {tab.id === 'gaps' && state && (
                    <span className="px-1.5 py-0.2 text-[10px] font-bold bg-primary/25 text-primary rounded-full border border-primary/30">
                      {state.final_gaps.length}
                    </span>
                  )}
                  {tab.id === 'papers' && state && (
                    <span className="px-1.5 py-0.2 text-[10px] font-medium bg-muted text-muted-foreground rounded-full border border-border">
                      {state.papers.length}
                    </span>
                  )}
                </button>
              )
            })}
          </nav>
        </div>

        {/* Tab content */}
        <main className="flex-1 overflow-auto bg-background/30 p-2 sm:p-4">
          {activeTab === 'gaps'     && <GapsTab state={state} isRunning={isRunning} />}
          {activeTab === 'graph'    && <GraphTab state={state} />}
          {activeTab === 'papers'   && <PapersTab state={state} />}
          {activeTab === 'log'      && <LogTab state={state} jobStatus={jobStatus} />}
          {activeTab === 'pipeline' && <PipelineFlow isRunning={isRunning} jobStatus={jobStatus} state={state} />}
        </main>
      </div>
    </div>
  )
}
