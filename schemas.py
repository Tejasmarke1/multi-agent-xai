"""
Typed data contracts passed between agents in the LangGraph pipeline.
Keeping these explicit is what makes the multi-agent state auditable —
every agent reads/writes a well-defined slice of PipelineState.
"""
from __future__ import annotations

import operator
from typing import Annotated, Optional

from pydantic import BaseModel, Field


class Paper(BaseModel):
    paper_id: str
    title: str
    abstract: str
    authors: list[str] = Field(default_factory=list)
    published: Optional[str] = None       # ISO date string
    url: Optional[str] = None
    full_text: Optional[str] = None       # populated by ParserAgent if PDF was fetched
    citation_count: Optional[int] = None  # populated if a citation source is wired in


class PaperSummary(BaseModel):
    paper_id: str
    problem: str
    method: str
    dataset: str
    key_result: str
    limitations: str
    claimed_contribution: str


class GraphNode(BaseModel):
    node_id: str
    node_type: str  # "problem" | "method" | "dataset"
    label: str
    paper_ids: list[str] = Field(default_factory=list)


class Contradiction(BaseModel):
    paper_id_a: str
    paper_id_b: str
    claim_a: str
    claim_b: str
    contradiction_score: float  # NLI "contradiction" probability
    explanation: str = ""


class CandidateGap(BaseModel):
    gap_id: str
    description: str
    related_paper_ids: list[str]
    evidence_type: str  # "embedding_sparsity" | "graph_missing_edge" | "contradiction" | "llm_synthesis"
    raw_evidence: dict = Field(default_factory=dict)
    density_score: float = 0.0
    recency_score: float = 0.0
    citation_velocity_score: float = 0.0
    critic_score: float = 0.0
    final_score: float = 0.0
    critic_verdict: str = ""
    explanation: str = ""


class PipelineState(BaseModel):
    """
    The single object threaded through every node in the LangGraph graph.

    `raw_gaps` and `log` use an `operator.add` reducer because three
    independent agent nodes (embedding, graph, contradiction) write to them
    IN PARALLEL in the same superstep — without a reducer, LangGraph's
    default last-write-wins channel would raise a conflict, or silently drop
    two of the three branches' results. With the reducer, parallel writes are
    concatenated instead of overwritten. `candidate_gaps` is deliberately a
    SEPARATE, non-reduced field: the critique/score nodes run sequentially
    (after the parallel fan-in) and need to REPLACE it (filter, then sort),
    not append to it — mixing both behaviors on one field would double-count
    gaps every time it's reassigned.
    """

    topic: str
    papers: list[Paper] = Field(default_factory=list)
    summaries: list[PaperSummary] = Field(default_factory=list)
    embeddings: dict = Field(default_factory=dict)          # paper_id -> list[float]
    graph_nodes: list[GraphNode] = Field(default_factory=list)
    contradictions: list[Contradiction] = Field(default_factory=list)
    raw_gaps: Annotated[list[CandidateGap], operator.add] = Field(default_factory=list)
    candidate_gaps: list[CandidateGap] = Field(default_factory=list)
    final_gaps: list[CandidateGap] = Field(default_factory=list)
    log: Annotated[list[str], operator.add] = Field(default_factory=list)
