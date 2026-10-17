"""
GapDetectorAgent — synthesizes evidence from the embedding-sparsity layer,
the knowledge-graph missing-edge layer, and the contradiction layer into a
unified list of CandidateGap objects. The LLM's job here is narrow and
constrained: turn *evidence it's given* into a readable gap description —
it is not asked to invent gaps from nothing, which is what keeps this
grounded rather than hallucinated.
"""
from __future__ import annotations

import logging
import uuid

from llm_client import LLMClient
from schemas import CandidateGap, Contradiction, Paper, PaperSummary

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = (
    "You are a research strategist. You are given structured EVIDENCE about "
    "gaps in a literature base. You must describe the gap in plain language "
    "using ONLY the evidence provided. Do not invent facts not present in the evidence."
)

DENSITY_PROMPT = """\
EVIDENCE (embedding-space sparsity cluster — these papers are topically isolated
from the rest of the corpus, suggesting an under-explored region):

{paper_lines}

In 2-3 sentences, describe what research gap this isolation might indicate,
referencing the specific papers by title. Return JSON: {{"description": "..."}}
"""

GRAPH_PROMPT = """\
EVIDENCE (knowledge-graph missing edge — this method is well-studied
({method_count} papers), this dataset is well-studied ({dataset_count} papers),
but they have never been combined in this corpus):

Method: {method}
Dataset: {dataset}

In 1-2 sentences, describe the research gap this represents. Return JSON: {{"description": "..."}}
"""


class GapDetectorAgent:
    def __init__(self, llm: LLMClient | None = None):
        self.llm = llm or LLMClient()

    def from_density_clusters(
        self, clusters: list[list[str]], papers_by_id: dict[str, Paper]
    ) -> list[CandidateGap]:
        gaps = []
        for cluster in clusters:
            if len(cluster) < 1:
                continue
            paper_lines = "\n".join(f"- {papers_by_id[pid].title}" for pid in cluster if pid in papers_by_id)
            data = self.llm.complete_json(DENSITY_PROMPT.format(paper_lines=paper_lines), system=SYSTEM_PROMPT)
            gaps.append(
                CandidateGap(
                    gap_id=str(uuid.uuid4())[:8],
                    description=data.get("description", "Isolated cluster in embedding space — under-explored area."),
                    related_paper_ids=cluster,
                    evidence_type="embedding_sparsity",
                    raw_evidence={"cluster_size": len(cluster)},
                )
            )
        return gaps

    def from_graph_gaps(self, graph_gaps: list[dict]) -> list[CandidateGap]:
        gaps = []
        for g in graph_gaps:
            data = self.llm.complete_json(
                GRAPH_PROMPT.format(
                    method=g["method"],
                    dataset=g["dataset"],
                    method_count=len(g["method_paper_ids"]),
                    dataset_count=len(g["dataset_paper_ids"]),
                ),
                system=SYSTEM_PROMPT,
            )
            gaps.append(
                CandidateGap(
                    gap_id=str(uuid.uuid4())[:8],
                    description=data.get(
                        "description", f"'{g['method']}' has never been applied to '{g['dataset']}' in this corpus."
                    ),
                    related_paper_ids=list(set(g["method_paper_ids"] + g["dataset_paper_ids"])),
                    evidence_type="graph_missing_edge",
                    raw_evidence=g,
                )
            )
        return gaps

    def from_contradictions(
        self, contradictions: list[Contradiction], summaries_by_id: dict[str, PaperSummary]
    ) -> list[CandidateGap]:
        gaps = []
        for c in contradictions:
            description = (
                f"Unresolved disagreement: '{c.claim_a}' vs '{c.claim_b}' "
                "— a replication or reconciliation study is a concrete gap here."
            )
            gaps.append(
                CandidateGap(
                    gap_id=str(uuid.uuid4())[:8],
                    description=description,
                    related_paper_ids=[c.paper_id_a, c.paper_id_b],
                    evidence_type="contradiction",
                    raw_evidence={"contradiction_score": c.contradiction_score},
                )
            )
        return gaps
