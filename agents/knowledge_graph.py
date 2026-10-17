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
            
            # Only index valid datasets (ignore "not specified", "n/a", "none")
            dataset_clean = s.dataset.strip().lower()
            if dataset_clean and not any(dataset_clean.startswith(ign) for ign in ("not specified", "none", "n/a", "no dataset", "not mentioned")):
                dataset_id = self._add_node("dataset", s.dataset, s.paper_id)
                self.graph.add_edge(method_id, dataset_id, paper_id=s.paper_id)

            self.graph.add_edge(problem_id, method_id, paper_id=s.paper_id)
        return self.graph

    def _add_node(self, node_type: str, label: str, paper_id: str) -> str:
        # Normalize and truncate overly long labels for graph clarity
        clean_label = label.strip()
        if len(clean_label) > 120:
            clean_label = clean_label[:117] + "..."
        nid = _node_id(node_type, clean_label)
        if self.graph.has_node(nid):
            if paper_id not in self.graph.nodes[nid]["paper_ids"]:
                self.graph.nodes[nid]["paper_ids"].append(paper_id)
        else:
            self.graph.add_node(nid, node_type=node_type, label=clean_label, paper_ids=[paper_id])
        return nid

    def export_nodes(self) -> list[GraphNode]:
        return [
            GraphNode(node_id=n, node_type=d["node_type"], label=d["label"], paper_ids=d["paper_ids"])
            for n, d in self.graph.nodes(data=True)
        ]

    def find_missing_method_dataset_pairs(self, min_support: int = 2) -> list[dict]:
        """
        Core graph-query novelty: methods and datasets (or methods and open problems)
        that are studied in distinct papers but never combined.
        Falls back to min_support=1 if strict frequency requirement yields no pairs.
        """
        methods = [n for n, d in self.graph.nodes(data=True) if d["node_type"] == "method"]
        datasets = [n for n, d in self.graph.nodes(data=True) if d["node_type"] == "dataset"]

        # If no datasets are available, look for cross-problem method transfer gaps
        if not datasets:
            return self._find_method_problem_transfer_gaps(methods)

        frequent_methods = [m for m in methods if len(self.graph.nodes[m]["paper_ids"]) >= min_support]
        frequent_datasets = [d for d in datasets if len(self.graph.nodes[d]["paper_ids"]) >= min_support]

        # Adaptive fallback: if no frequent entities exist, use all valid distinct methods & datasets
        if not frequent_methods or not frequent_datasets:
            frequent_methods = methods[:10]
            frequent_datasets = datasets[:10]

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
                if len(gaps) >= 8:  # cap to top 8 highest quality pairs
                    break
        return gaps

    def _find_method_problem_transfer_gaps(self, methods: list[str]) -> list[dict]:
        """Fallback when datasets are unstated: identify method-to-problem transfer gaps."""
        problems = [n for n, d in self.graph.nodes(data=True) if d["node_type"] == "problem"]
        gaps = []
        for method_id, problem_id in itertools.product(methods[:8], problems[:8]):
            method_papers = set(self.graph.nodes[method_id]["paper_ids"])
            problem_papers = set(self.graph.nodes[problem_id]["paper_ids"])
            if not (method_papers & problem_papers):
                gaps.append(
                    {
                        "method": self.graph.nodes[method_id]["label"],
                        "dataset": f"Open problem: {self.graph.nodes[problem_id]['label']}",
                        "method_paper_ids": list(method_papers),
                        "dataset_paper_ids": list(problem_papers),
                    }
                )
                if len(gaps) >= 6:
                    break
        return gaps

    def _co_occur(self, method_id: str, dataset_id: str) -> bool:
        method_papers = set(self.graph.nodes[method_id]["paper_ids"])
        dataset_papers = set(self.graph.nodes[dataset_id]["paper_ids"])
        return bool(method_papers & dataset_papers)

