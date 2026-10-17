// Types matching the Python Pydantic schemas

export interface Paper {
  paper_id: string
  title: string
  abstract: string
  authors: string[]
  published: string | null
  url: string | null
  full_text: string | null
  citation_count: number | null
}

export interface PaperSummary {
  paper_id: string
  problem: string
  method: string
  dataset: string
  key_result: string
  limitations: string
  claimed_contribution: string
}

export interface GraphNode {
  node_id: string
  node_type: 'problem' | 'method' | 'dataset'
  label: string
  paper_ids: string[]
}

export interface Contradiction {
  paper_id_a: string
  paper_id_b: string
  claim_a: string
  claim_b: string
  contradiction_score: number
  explanation: string
}

export interface CandidateGap {
  gap_id: string
  description: string
  related_paper_ids: string[]
  evidence_type: 'embedding_sparsity' | 'graph_missing_edge' | 'contradiction' | 'llm_synthesis'
  raw_evidence: Record<string, unknown>
  density_score: number
  recency_score: number
  citation_velocity_score: number
  critic_score: number
  final_score: number
  critic_verdict: string
  explanation: string
}

export interface PipelineState {
  topic: string
  papers: Paper[]
  summaries: PaperSummary[]
  embeddings: Record<string, number[]>
  graph_nodes: GraphNode[]
  contradictions: Contradiction[]
  raw_gaps: CandidateGap[]
  candidate_gaps: CandidateGap[]
  final_gaps: CandidateGap[]
  log: string[]
}

export interface JobStatus {
  status: 'queued' | 'running' | 'done' | 'error'
  progress: string
  result: PipelineState | null
  error?: string | null
  log_live?: string[]
}

export interface FeedbackRow {
  gap_id: string
  density_score: number
  recency_score: number
  citation_velocity_score: number
  critic_score: number
  label: 0 | 1
}

export interface CalibrateResult {
  weight_density: number
  weight_recency: number
  weight_citation_velocity: number
  weight_critic: number
}
