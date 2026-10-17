import { useMemo, useState } from 'react'
import { PipelineState, GraphNode } from '../types'
import { getNodeColor } from '../lib/utils'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, PieChart, Pie, Legend
} from 'recharts'
import { Network, AlertTriangle } from 'lucide-react'

interface GraphTabProps {
  state: PipelineState | null
}

// Simple force-layout approximation using fixed positions for demo
function generateLayout(nodes: GraphNode[]) {
  const byType: Record<string, GraphNode[]> = { problem: [], method: [], dataset: [] }
  nodes.forEach(n => {
    if (byType[n.node_type]) byType[n.node_type].push(n)
  })

  const positions: Record<string, { x: number; y: number }> = {}
  const W = 800, H = 400
  const cols = { problem: 0.15, method: 0.5, dataset: 0.85 }

  ;(['problem', 'method', 'dataset'] as const).forEach(type => {
    const group = byType[type]
    group.forEach((node, i) => {
      const count = group.length
      const yStep = count > 1 ? H / (count + 1) : H / 2
      positions[node.node_id] = {
        x: cols[type] * W,
        y: (i + 1) * yStep,
      }
    })
  })
  return positions
}

const TOOLTIP_STYLE = {
  backgroundColor: '#0a0f1d',
  border: '1px solid rgba(255, 255, 255, 0.1)',
  borderRadius: '12px',
  color: '#f8fafc',
  fontSize: '12px',
  boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.6)',
}

export default function GraphTab({ state }: GraphTabProps) {
  const [hoveredNode, setHoveredNode] = useState<string | null>(null)

  if (!state) {
    return (
      <div className="flex items-center justify-center h-full min-h-[500px]">
        <div className="text-center space-y-4 max-w-md p-8 rounded-2xl glass-card border border-white/[0.07] shadow-2xl">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-cyan-500/20 via-blue-500/10 to-indigo-500/20 border border-cyan-500/30 flex items-center justify-center mx-auto text-cyan-300 shadow-inner">
            <Network className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-slate-100 tracking-tight">No Knowledge Graph Available</h2>
            <p className="text-xs text-slate-400 mt-1.5 leading-relaxed">
              Execute the pipeline on any scientific domain to construct the problem, method, and dataset relationship topology.
            </p>
          </div>
        </div>
      </div>
    )
  }

  const { graph_nodes, contradictions } = state

  // Bar chart data
  const countsByType = useMemo(() => {
    const acc: Record<string, number> = {}
    graph_nodes.forEach(n => { acc[n.node_type] = (acc[n.node_type] || 0) + 1 })
    return Object.entries(acc).map(([name, value]) => ({ name, value }))
  }, [graph_nodes])

  // Pie chart for papers coverage
  const piData = useMemo(() => {
    const total = state.papers.length
    const withSummary = state.summaries.length
    return [
      { name: 'Summarized', value: withSummary },
      { name: 'Awaiting', value: Math.max(0, total - withSummary) },
    ]
  }, [state])

  const positions = useMemo(() => generateLayout(graph_nodes), [graph_nodes])

  // SVG dimensions
  const W = 800, H = 400

  // Node connections: paper_ids overlap between pairs
  const edges = useMemo(() => {
    const pairs: { a: string; b: string }[] = []
    for (let i = 0; i < graph_nodes.length; i++) {
      for (let j = i + 1; j < graph_nodes.length; j++) {
        const a = graph_nodes[i]
        const b = graph_nodes[j]
        if (a.node_type !== b.node_type) {
          const shared = a.paper_ids.filter(pid => b.paper_ids.includes(pid))
          if (shared.length > 0) pairs.push({ a: a.node_id, b: b.node_id })
        }
      }
    }
    return pairs.slice(0, 60) // limit for perf
  }, [graph_nodes])

  const hoverNode = graph_nodes.find(n => n.node_id === hoveredNode)

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between flex-wrap gap-4 pb-2 border-b border-white/[0.06]">
        <div>
          <h2 className="text-base font-semibold text-slate-100 tracking-tight">
            Scientific Knowledge Graph Topology
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            <span className="text-cyan-400 font-mono font-medium">{graph_nodes.length}</span> semantic nodes across {countsByType.length} entity types · edges indicate co-investigation in literature
          </p>
        </div>
      </div>

      {graph_nodes.length === 0 ? (
        <div className="glass-card border border-white/[0.08] rounded-2xl p-12 text-center">
          <Network className="w-10 h-10 text-slate-500 mx-auto mb-3" />
          <p className="text-sm text-slate-400">No graph nodes detected. Try running with a broader research domain.</p>
        </div>
      ) : (
        <>
          {/* SVG graph visualization */}
          <div className="glass-card border border-white/[0.08] rounded-2xl overflow-hidden shadow-2xl">
            <div className="px-5 py-3.5 border-b border-white/[0.07] flex items-center justify-between bg-slate-950/40">
              <span className="text-xs font-mono font-semibold uppercase tracking-wider text-slate-300 flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
                Tripartite Entity Projection (Problem → Method → Dataset)
              </span>
              <div className="flex items-center gap-4 text-xs">
                {(['problem', 'method', 'dataset'] as const).map(type => (
                  <span key={type} className="flex items-center gap-1.5 text-slate-400 font-mono text-[11px] capitalize">
                    <span className="w-2.5 h-2.5 rounded-full shadow-sm" style={{ background: getNodeColor(type), boxShadow: `0 0 8px ${getNodeColor(type)}` }} />
                    {type}
                  </span>
                ))}
              </div>
            </div>
            <div className="overflow-x-auto bg-[#070b16] p-2 relative">
              <svg
                width={W}
                height={H}
                className="block mx-auto"
                style={{ fontFamily: 'inherit' }}
              >
                <defs>
                  {/* Dot Grid Pattern */}
                  <pattern id="graph-grid" width="24" height="24" patternUnits="userSpaceOnUse">
                    <circle cx="2" cy="2" r="1" fill="rgba(255, 255, 255, 0.05)" />
                  </pattern>
                  {/* Subtle Column Guides */}
                  <linearGradient id="edge-gradient" x1="0%" y1="0%" x2="100%" y2="0%">
                    <stop offset="0%" stopColor="#38bdf8" stopOpacity="0.4" />
                    <stop offset="50%" stopColor="#818cf8" stopOpacity="0.2" />
                    <stop offset="100%" stopColor="#34d399" stopOpacity="0.4" />
                  </linearGradient>
                </defs>

                {/* Grid Background */}
                <rect width={W} height={H} fill="url(#graph-grid)" />

                {/* Column Column Labels */}
                <text x={W * 0.15} y={26} textAnchor="middle" fill="#64748b" fontSize={11} fontWeight="600" letterSpacing="0.08em" fontFamily="monospace">
                  PROBLEMS
                </text>
                <text x={W * 0.5} y={26} textAnchor="middle" fill="#64748b" fontSize={11} fontWeight="600" letterSpacing="0.08em" fontFamily="monospace">
                  METHODS
                </text>
                <text x={W * 0.85} y={26} textAnchor="middle" fill="#64748b" fontSize={11} fontWeight="600" letterSpacing="0.08em" fontFamily="monospace">
                  DATASETS
                </text>

                {/* Edges */}
                <g>
                  {edges.map((edge, i) => {
                    const a = positions[edge.a]
                    const b = positions[edge.b]
                    if (!a || !b) return null
                    const isEdgeActive = hoveredNode === edge.a || hoveredNode === edge.b
                    return (
                      <line
                        key={i}
                        x1={a.x} y1={a.y}
                        x2={b.x} y2={b.y}
                        stroke={isEdgeActive ? '#38bdf8' : 'rgba(148, 163, 184, 0.18)'}
                        strokeWidth={isEdgeActive ? 2 : 1}
                        strokeDasharray={isEdgeActive ? 'none' : '3 3'}
                        style={{ transition: 'stroke 0.2s, stroke-width 0.2s' }}
                      />
                    )
                  })}
                </g>

                {/* Nodes */}
                {graph_nodes.map(node => {
                  const pos = positions[node.node_id]
                  if (!pos) return null
                  const color = getNodeColor(node.node_type)
                  const isHovered = hoveredNode === node.node_id
                  const r = Math.max(7, Math.min(15, 5 + node.paper_ids.length * 1.5))

                  return (
                    <g
                      key={node.node_id}
                      transform={`translate(${pos.x}, ${pos.y})`}
                      className="cursor-pointer"
                      onMouseEnter={() => setHoveredNode(node.node_id)}
                      onMouseLeave={() => setHoveredNode(null)}
                    >
                      {/* Outer pulse when hovered */}
                      {isHovered && (
                        <circle r={r * 2.2} fill={color} opacity={0.2} className="animate-pulse" />
                      )}
                      <circle
                        r={isHovered ? r * 1.3 : r}
                        fill={color}
                        stroke="#0a0f1d"
                        strokeWidth={2}
                        opacity={isHovered ? 1 : 0.85}
                        style={{
                          transition: 'r 0.15s ease, opacity 0.15s ease',
                          filter: isHovered ? `drop-shadow(0 0 8px ${color})` : 'none',
                        }}
                      />
                      {r >= 7 && (
                        <text
                          textAnchor="middle"
                          dy={-r - 5}
                          fontSize={10}
                          fontWeight="500"
                          fill={isHovered ? '#ffffff' : '#cbd5e1'}
                          style={{ pointerEvents: 'none', textShadow: '0 1px 3px rgba(0,0,0,0.8)' }}
                        >
                          {node.label.length > 20 ? node.label.slice(0, 20) + '…' : node.label}
                        </text>
                      )}
                    </g>
                  )
                })}
              </svg>
            </div>

            {/* Hover tooltip bar */}
            {hoverNode ? (
              <div className="px-5 py-2.5 border-t border-white/[0.08] bg-slate-900/90 text-xs flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full" style={{ background: getNodeColor(hoverNode.node_type) }} />
                  <span className="font-semibold text-slate-100">{hoverNode.label}</span>
                  <span className="text-slate-400 font-mono text-[11px]">({hoverNode.node_type})</span>
                </div>
                <div className="text-slate-400 text-xs font-mono">
                  Grounding: <span className="text-cyan-300 font-semibold">{hoverNode.paper_ids.length}</span> papers
                </div>
              </div>
            ) : (
              <div className="px-5 py-2.5 border-t border-white/[0.05] bg-slate-950/40 text-[11px] text-slate-500 font-mono text-center">
                Hover over any node to inspect semantic grounding and cross-connections
              </div>
            )}
          </div>

          {/* Charts row */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {/* Bar chart */}
            <div className="glass-card border border-white/[0.08] rounded-2xl p-5 shadow-xl">
              <div className="text-xs font-mono font-semibold uppercase tracking-wider text-slate-300 mb-4 flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-cyan-400" />
                Entity Distribution By Type
              </div>
              <ResponsiveContainer width="100%" height={210}>
                <BarChart data={countsByType} margin={{ top: 5, right: 10, left: -20, bottom: 5 }}>
                  <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#94a3b8' }} stroke="#334155" />
                  <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} stroke="#334155" />
                  <Tooltip contentStyle={TOOLTIP_STYLE} />
                  <Bar dataKey="value" radius={[6, 6, 0, 0]}>
                    {countsByType.map((entry) => (
                      <Cell key={entry.name} fill={getNodeColor(entry.name)} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Pie chart for paper coverage */}
            <div className="glass-card border border-white/[0.08] rounded-2xl p-5 shadow-xl">
              <div className="text-xs font-mono font-semibold uppercase tracking-wider text-slate-300 mb-4 flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-indigo-400" />
                Structured Extraction Coverage
              </div>
              <ResponsiveContainer width="100%" height={210}>
                <PieChart>
                  <Pie
                    data={piData}
                    cx="50%"
                    cy="50%"
                    innerRadius={45}
                    outerRadius={75}
                    paddingAngle={4}
                    dataKey="value"
                    label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                    labelLine={false}
                  >
                    <Cell fill="#38bdf8" stroke="#0a0f1d" strokeWidth={2} />
                    <Cell fill="#1e293b" stroke="#0a0f1d" strokeWidth={2} />
                  </Pie>
                  <Tooltip contentStyle={TOOLTIP_STYLE} />
                  <Legend wrapperStyle={{ fontSize: 11, color: '#94a3b8' }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Node table */}
          <div className="glass-card border border-white/[0.08] rounded-2xl overflow-hidden shadow-xl">
            <div className="px-5 py-3.5 border-b border-white/[0.07] bg-slate-950/40 flex items-center justify-between">
              <span className="text-xs font-mono font-semibold uppercase tracking-wider text-slate-300">
                Indexed Semantic Entities ({graph_nodes.length})
              </span>
            </div>
            <div className="overflow-x-auto max-h-72">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-white/[0.06] bg-slate-900/60 sticky top-0 backdrop-blur-md">
                    <th className="text-left text-[11px] font-mono font-semibold text-slate-400 px-4 py-2.5 uppercase tracking-wider">Type</th>
                    <th className="text-left text-[11px] font-mono font-semibold text-slate-400 px-4 py-2.5 uppercase tracking-wider">Label</th>
                    <th className="text-right text-[11px] font-mono font-semibold text-slate-400 px-4 py-2.5 uppercase tracking-wider">Papers Cited</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.04]">
                  {graph_nodes.map(node => (
                    <tr key={node.node_id} className="hover:bg-slate-800/40 transition-colors">
                      <td className="px-4 py-2.5">
                        <span
                          className="text-[10px] font-mono uppercase px-2 py-0.5 rounded-full font-medium"
                          style={{
                            background: getNodeColor(node.node_type) + '20',
                            color: getNodeColor(node.node_type),
                            border: `1px solid ${getNodeColor(node.node_type)}40`,
                          }}
                        >
                          {node.node_type}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-slate-200 font-medium">{node.label}</td>
                      <td className="px-4 py-2.5 text-slate-400 font-mono text-right">{node.paper_ids.length}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* Contradictions */}
      {contradictions.length > 0 && (
        <div className="border border-amber-500/30 rounded-2xl bg-gradient-to-br from-amber-950/20 via-slate-900/60 to-slate-900/80 shadow-xl shadow-amber-950/20 overflow-hidden">
          <div className="px-5 py-3.5 border-b border-amber-500/20 flex items-center justify-between bg-amber-500/10">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-400" />
              <span className="text-xs font-mono font-semibold uppercase tracking-wider text-amber-200">
                {contradictions.length} Verified Contradiction{contradictions.length !== 1 ? 's' : ''} (NLI DeBERTa)
              </span>
            </div>
            <span className="text-[11px] font-mono text-amber-300/80 bg-amber-500/20 border border-amber-500/30 px-2 py-0.5 rounded-md">
              Evidence Grounded
            </span>
          </div>
          <div className="divide-y divide-amber-500/10">
            {contradictions.map((c, i) => (
              <div key={i} className="p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="text-[11px] font-mono uppercase tracking-wider text-amber-400 font-semibold">
                    Confidence: {(c.contradiction_score * 100).toFixed(0)}%
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="bg-slate-900/80 rounded-xl p-3.5 border border-white/[0.06] text-xs text-slate-200 space-y-1">
                    <span className="text-[10px] font-mono text-cyan-400 font-semibold uppercase tracking-wider">Claim Alpha</span>
                    <p className="leading-relaxed text-slate-300">{c.claim_a}</p>
                  </div>
                  <div className="bg-slate-900/80 rounded-xl p-3.5 border border-white/[0.06] text-xs text-slate-200 space-y-1">
                    <span className="text-[10px] font-mono text-rose-400 font-semibold uppercase tracking-wider">Claim Beta (Contradictory)</span>
                    <p className="leading-relaxed text-slate-300">{c.claim_b}</p>
                  </div>
                </div>
                {c.explanation && (
                  <p className="text-xs text-slate-400 bg-slate-950/60 p-3 rounded-xl border border-white/[0.04] leading-relaxed">
                    <span className="text-amber-400 font-medium">Synthesis: </span>
                    {c.explanation}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

