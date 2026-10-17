"""
Orchestrator — wires every agent into a LangGraph StateGraph.

Pipeline:
  retrieve -> parse -> summarize -> [embed_and_cluster, build_graph, detect_contradictions]
           -> synthesize_gaps -> critique -> score -> explain -> END

The three bracketed nodes are independent evidence sources that all feed the
same synthesize_gaps node — this is the "multi-agent" fan-in that makes gap
detection triangulated rather than single-signal.
"""
from __future__ import annotations

import logging

from langgraph.graph import END, StateGraph

from agents.contradiction import ContradictionAgent
from agents.critic import CriticAgent
from agents.embedding_space import EmbeddingSpaceAgent
from agents.explainer import ExplainerAgent
from agents.gap_detector import GapDetectorAgent
from agents.knowledge_graph import KnowledgeGraphAgent
from agents.parser import ParserAgent
from agents.retriever import RetrieverAgent
from agents.summarizer import SummarizerAgent
from config import SETTINGS
from llm_client import LLMClient
from schemas import PipelineState
from scoring import score_all

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
logger = logging.getLogger(__name__)


class ResearchGapPipeline:
    def __init__(self):
        self.llm = LLMClient()
        self.retriever = RetrieverAgent()
        self.parser = ParserAgent()
        self.summarizer = SummarizerAgent(self.llm)
        self.embedder = EmbeddingSpaceAgent()
        self.kg = KnowledgeGraphAgent()
        self.contradiction_agent = ContradictionAgent()
        self.gap_detector = GapDetectorAgent(self.llm)
        self.critic = CriticAgent(self.llm)
        self.explainer = ExplainerAgent(self.llm)
        self.graph = self._build_graph()

    # ---- node functions --------------------------------------------------
    # Every node returns a PARTIAL dict of only the fields it updates. This
    # is the LangGraph-idiomatic pattern and is what makes the reducers in
    # PipelineState (raw_gaps, log) behave correctly under parallel fan-out.
    def _n_retrieve(self, state: PipelineState) -> dict:
        papers = self.retriever.search(state.topic)
        return {"papers": papers, "log": [f"Retrieved {len(papers)} papers for topic '{state.topic}'."]}

    def _n_parse(self, state: PipelineState) -> dict:
        papers = [self.parser.parse(p) for p in state.papers]
        return {"papers": papers, "log": ["Parsed full text where available."]}

    def _n_summarize(self, state: PipelineState) -> dict:
        summaries = self.summarizer.summarize_all(state.papers)
        return {"summaries": summaries, "log": [f"Summarized {len(summaries)} papers."]}

    def _n_embed_and_cluster(self, state: PipelineState) -> dict:
        embeddings = self.embedder.embed_papers(state.papers)
        density = self.embedder.compute_density_scores(embeddings)
        clusters = self.embedder.sparse_region_clusters(embeddings, density)
        papers_by_id = {p.paper_id: p for p in state.papers}
        density_gaps = self.gap_detector.from_density_clusters(clusters, papers_by_id)
        for g in density_gaps:
            g.raw_evidence["density_score"] = max(
                (density.get(pid, 0.0) for pid in g.related_paper_ids), default=0.65
            )

        # Cross-literature synthesis layer: extracts grounded macro gaps from collective limitations
        synthesis_gaps = self.gap_detector.from_literature_synthesis(state.summaries, state.topic)

        all_gaps = density_gaps + synthesis_gaps
        return {
            "embeddings": {k: v.tolist() for k, v in embeddings.items()},
            "raw_gaps": all_gaps,
            "log": [
                f"Embedding-sparsity layer: {len(density_gaps)} gap(s) from {len(clusters)} cluster(s).",
                f"Literature-synthesis layer: {len(synthesis_gaps)} cross-paper gap(s) triangulated.",
            ],
        }

    def _n_build_graph(self, state: PipelineState) -> dict:
        self.kg.build(state.summaries)
        graph_nodes = self.kg.export_nodes()
        missing_pairs = self.kg.find_missing_method_dataset_pairs()
        graph_gaps = self.gap_detector.from_graph_gaps(missing_pairs)
        return {
            "graph_nodes": graph_nodes,
            "raw_gaps": graph_gaps,
            "log": [f"Knowledge-graph layer: {len(graph_gaps)} candidate gap(s) from missing method/dataset pairs."],
        }

    def _n_detect_contradictions(self, state: PipelineState) -> dict:
        contradictions = self.contradiction_agent.find_contradictions(state.summaries)
        summaries_by_id = {s.paper_id: s for s in state.summaries}
        contradiction_gaps = self.gap_detector.from_contradictions(contradictions, summaries_by_id)
        return {
            "contradictions": contradictions,
            "raw_gaps": contradiction_gaps,
            "log": [f"Contradiction layer: {len(contradictions)} contradiction(s) found."],
        }

    def _n_critique(self, state: PipelineState) -> dict:
        papers_by_id = {p.paper_id: p for p in state.papers}
        raw_gaps = state.raw_gaps

        # Fallback: if earlier layers were somehow starved, synthesize directly
        if not raw_gaps:
            raw_gaps = self.gap_detector.from_literature_synthesis(state.summaries, state.topic)

        critiqued = self.critic.critique_all(raw_gaps, papers_by_id)
        
        # Primary filter by confidence threshold
        strong = [g for g in critiqued if g.critic_score >= SETTINGS.min_gap_confidence]

        # Safety guarantee: ensure the top candidate gaps survive for scoring
        target_count = min(len(critiqued), max(3, len(strong)))
        if len(strong) < target_count and critiqued:
            sorted_critiqued = sorted(critiqued, key=lambda g: g.critic_score, reverse=True)
            strong = sorted_critiqued[:target_count]

        return {
            "candidate_gaps": strong,
            "log": [f"Critic agent: selected top {len(strong)}/{len(critiqued)} candidate gap(s) for final scoring."],
        }

    def _n_score(self, state: PipelineState) -> dict:
        papers_by_id = {p.paper_id: p for p in state.papers}
        ranked = score_all(state.candidate_gaps, papers_by_id)
        return {"candidate_gaps": ranked, "log": [f"Scored and ranked {len(ranked)} surviving candidate gap(s)."]}

    def _n_explain(self, state: PipelineState) -> dict:
        papers_by_id = {p.paper_id: p for p in state.papers}
        final_gaps = self.explainer.explain_all(state.candidate_gaps, papers_by_id)
        return {"final_gaps": final_gaps, "log": [f"Generated evidence-grounded XAI explanations for {len(final_gaps)} final gap(s)."]}


    # ---- graph assembly -------------------------------------------------
    def _build_graph(self):
        g = StateGraph(PipelineState)
        g.add_node("retrieve", self._n_retrieve)
        g.add_node("parse", self._n_parse)
        g.add_node("summarize", self._n_summarize)
        g.add_node("embed_and_cluster", self._n_embed_and_cluster)
        g.add_node("build_graph", self._n_build_graph)
        g.add_node("detect_contradictions", self._n_detect_contradictions)
        g.add_node("critique", self._n_critique)
        g.add_node("score", self._n_score)
        g.add_node("explain", self._n_explain)

        g.set_entry_point("retrieve")
        g.add_edge("retrieve", "parse")
        g.add_edge("parse", "summarize")
        # fan-out: three independent evidence sources
        g.add_edge("summarize", "embed_and_cluster")
        g.add_edge("summarize", "build_graph")
        g.add_edge("summarize", "detect_contradictions")
        # fan-in: all three must complete before critique
        g.add_edge("embed_and_cluster", "critique")
        g.add_edge("build_graph", "critique")
        g.add_edge("detect_contradictions", "critique")
        g.add_edge("critique", "score")
        g.add_edge("score", "explain")
        g.add_edge("explain", END)
        return g.compile()

    def run(self, topic: str) -> PipelineState:
        initial_state = PipelineState(topic=topic)
        logger.info("Starting pipeline for topic: %s", topic)
        result = self.graph.invoke(initial_state)
        # LangGraph returns a dict-like state; coerce back to our schema
        return PipelineState(**result) if not isinstance(result, PipelineState) else result


if __name__ == "__main__":
    import sys

    topic = " ".join(sys.argv[1:]) or "explainable AI for code energy consumption"
    pipeline = ResearchGapPipeline()
    final_state = pipeline.run(topic)

    print(f"\n=== {len(final_state.final_gaps)} research gaps found for '{topic}' ===\n")
    for gap in final_state.final_gaps:
        print(f"[{gap.final_score:.2f}] ({gap.evidence_type}) {gap.description}")
        print(f"   -> {gap.explanation}\n")
