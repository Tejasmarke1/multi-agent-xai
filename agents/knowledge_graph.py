"""
KnowledgeGraphAgent — the second "novelty" layer.

Builds a tripartite graph: {problem} -- studied_with --> {method} -- applied_to --> {dataset},
with papers as edge attributes. Gap detection then becomes an explicit,
auditable graph query — "which (method, dataset) pairs are common elsewhere
but never combined?" — instead of an LLM guessing from prose.
"""
from __future__ import annotations

import hashlib
import itertools
import logging

import networkx as nx

from schemas import GraphNode, PaperSummary

logger = logging.getLogger(__name__)


def _node_id(node_type: str, label: str) -> str:
    key = f"{node_type}:{label.strip().lower()}"
    return hashlib.md5(key.encode()).hexdigest()[:10]


class KnowledgeGraphAgent:
    def __init__(self):
        self.graph = nx.Graph()

    def build(self, summaries: list[PaperSummary]) -> nx.Graph:
        for s in summaries:
            problem_id = self._add_node("problem", s.problem, s.paper_id)
            method_id = self._add_node("method", s.method, s.paper_id)
            dataset_id = self._add_node("dataset", s.dataset, s.paper_id)

            self.graph.add_edge(problem_id, method_id, paper_id=s.paper_id)
            self.graph.add_edge(method_id, dataset_id, paper_id=s.paper_id)
        return self.graph

    def _add_node(self, node_type: str, label: str, paper_id: str) -> str:
        nid = _node_id(node_type, label)
        if self.graph.has_node(nid):
            self.graph.nodes[nid]["paper_ids"].append(paper_id)
        else:
            self.graph.add_node(nid, node_type=node_type, label=label, paper_ids=[paper_id])
        return nid

    def export_nodes(self) -> list[GraphNode]:
        return [
            GraphNode(node_id=n, node_type=d["node_type"], label=d["label"], paper_ids=d["paper_ids"])
            for n, d in self.graph.nodes(data=True)
        ]

    def find_missing_method_dataset_pairs(self, min_support: int = 2) -> list[dict]:
        """
        Core graph-query novelty: methods and datasets that are each individually
        well-studied (used in >= min_support papers) but NEVER co-occur in the
        same paper. That combination is a structurally evidenced gap.
        """
        methods = [n for n, d in self.graph.nodes(data=True) if d["node_type"] == "method"]
        datasets = [n for n, d in self.graph.nodes(data=True) if d["node_type"] == "dataset"]

        frequent_methods = [m for m in methods if len(self.graph.nodes[m]["paper_ids"]) >= min_support]
        frequent_datasets = [d for d in datasets if len(self.graph.nodes[d]["paper_ids"]) >= min_support]

        gaps = []
        for method_id, dataset_id in itertools.product(frequent_methods, frequent_datasets):
            if not self._co_occur(method_id, dataset_id):
                gaps.append(
                    {
                        "method": self.graph.nodes[method_id]["label"],
                        "dataset": self.graph.nodes[dataset_id]["label"],
                        "method_paper_ids": self.graph.nodes[method_id]["paper_ids"],
                        "dataset_paper_ids": self.graph.nodes[dataset_id]["paper_ids"],
                    }
                )
        return gaps

    def _co_occur(self, method_id: str, dataset_id: str) -> bool:
        method_papers = set(self.graph.nodes[method_id]["paper_ids"])
        dataset_papers = set(self.graph.nodes[dataset_id]["paper_ids"])
        return bool(method_papers & dataset_papers)
