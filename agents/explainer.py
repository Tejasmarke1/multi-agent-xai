"""
ExplainerAgent — the XAI core of the system.

This is deliberately NOT "ask the LLM why". It assembles a structured,
human-readable explanation directly from the quantitative evidence objects
(density scores, graph structure, contradiction scores, critic verdict) that
produced the gap, in the same spirit as using SHAP values to explain a model
prediction rather than trusting a black-box summary. The LLM is only used to
turn already-verified evidence into fluent prose — never to add new claims.
"""
from __future__ import annotations

from llm_client import LLMClient
from schemas import CandidateGap, Paper

SYSTEM_PROMPT = (
    "You write clear, evidence-grounded explanations of research gaps for a "
    "technical audience. Every sentence you write must map to a fact given in "
    "the EVIDENCE section. Do not add unsupported claims."
)

EXPLAIN_PROMPT = """\
Gap description: {description}
Evidence type: {evidence_type}
Final composite score: {final_score:.2f} (0-1, higher = stronger gap)
  - embedding-density evidence: {density_score:.2f}
  - recency of supporting papers: {recency_score:.2f}
  - citation-velocity of supporting papers: {citation_velocity_score:.2f}
  - critic verdict: {critic_verdict} (confidence {critic_score:.2f})
  - critic reasoning: {critic_reasoning}
Supporting papers:
{paper_titles}

Write a 3-4 sentence explanation of WHY this is flagged as a research gap,
explicitly referencing at least two of the evidence numbers above and at
least one supporting paper by title. End with one concrete suggested next
step a researcher could take. Return JSON: {{"explanation": "..."}}
"""


class ExplainerAgent:
    def __init__(self, llm: LLMClient | None = None):
        self.llm = llm or LLMClient()

    def explain(self, gap: CandidateGap, papers_by_id: dict[str, Paper]) -> CandidateGap:
        titles = "\n".join(
            f"- {papers_by_id[pid].title}" for pid in gap.related_paper_ids if pid in papers_by_id
        ) or "(none available)"

        prompt = EXPLAIN_PROMPT.format(
            description=gap.description,
            evidence_type=gap.evidence_type,
            final_score=gap.final_score,
            density_score=gap.density_score,
            recency_score=gap.recency_score,
            citation_velocity_score=gap.citation_velocity_score,
            critic_verdict=gap.critic_verdict,
            critic_score=gap.critic_score,
            critic_reasoning=gap.raw_evidence.get("critic_reasoning", "not available"),
            paper_titles=titles,
        )
        data = self.llm.complete_json(prompt, system=SYSTEM_PROMPT)
        gap.explanation = data.get("explanation", self._template_fallback(gap))
        return gap

    def explain_all(self, gaps: list[CandidateGap], papers_by_id: dict[str, Paper]) -> list[CandidateGap]:
        import time
        results = []
        total = len(gaps)
        for i, g in enumerate(gaps):
            results.append(self.explain(g, papers_by_id))
            if i < total - 1:
                time.sleep(2.0)
        return results

    @staticmethod
    def _template_fallback(gap: CandidateGap) -> str:
        """Non-LLM fallback so explanations always exist, even offline."""
        return (
            f"Flagged via {gap.evidence_type.replace('_', ' ')} evidence "
            f"(composite score {gap.final_score:.2f}, critic verdict: {gap.critic_verdict}). "
            f"Supported by {len(gap.related_paper_ids)} paper(s)."
        )
