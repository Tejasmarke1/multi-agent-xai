import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatScore(score: number): string {
  return (score * 100).toFixed(0) + '%'
}

export function formatScoreRaw(score: number): string {
  return score.toFixed(2)
}

export function getEvidenceColor(evidenceType: string): string {
  switch (evidenceType) {
    case 'embedding_sparsity': return 'badge-embedding'
    case 'graph_missing_edge': return 'badge-graph'
    case 'contradiction': return 'badge-contradiction'
    case 'llm_synthesis': return 'badge-synthesis'
    default: return 'bg-muted text-muted-foreground'
  }
}

export function getEvidenceLabel(evidenceType: string): string {
  switch (evidenceType) {
    case 'embedding_sparsity': return '🔮 Embedding Sparsity'
    case 'graph_missing_edge': return '🕸️ Knowledge Graph'
    case 'contradiction': return '⚔️ Contradiction'
    case 'llm_synthesis': return '🤖 LLM Synthesis'
    default: return evidenceType
  }
}

export function scoreGradient(score: number): string {
  if (score >= 0.75) return 'text-emerald-400'
  if (score >= 0.5) return 'text-yellow-400'
  return 'text-red-400'
}

export function getNodeColor(nodeType: string): string {
  switch (nodeType) {
    case 'problem': return '#8b5cf6'  // violet
    case 'method': return '#0ea5e9'   // sky
    case 'dataset': return '#10b981'  // emerald
    default: return '#6b7280'
  }
}

export function formatDate(isoStr: string | null): string {
  if (!isoStr) return 'Unknown'
  try {
    return new Date(isoStr).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
  } catch {
    return isoStr
  }
}

export function truncate(str: string, maxLen = 120): string {
  if (str.length <= maxLen) return str
  return str.slice(0, maxLen) + '…'
}
