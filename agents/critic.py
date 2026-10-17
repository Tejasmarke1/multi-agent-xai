"""
CriticAgent — the fourth "novelty" layer.

Naive agent pipelines emit whatever the generator agent proposes. Here, every
CandidateGap is challenged by a second, independently-prompted LLM call that
is explicitly told to look for reasons the gap might be FALSE (already
addressed, too vague, evidence too weak) before it's allowed into the final
ranked list. This self-critique step is what reduces hallucinated gaps.
"""
from __future__ import annotations

import logging

from llm_client import LLMClient
from schemas import CandidateGap, Paper

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = (
    "You are an expert scientific peer reviewer evaluating candidate research gaps. "
    "Assess whether the claimed gap represents an authentic, constructive research opportunity. "
    "Calibrate your scoring fairly:\n"
    "- 0.70 - 1.00 (verdict: 'strong'): High-impact, actionable gap with clear motivation.\n"
    "- 0.40 - 0.69 (verdict: 'plausible'): Valid gap that can be explored with proper framing.\n"
    "- 0.20 - 0.39 (verdict: 'weak'): Developing concept or partially explored area requiring scoping.\n"
    "- 0.00 - 0.19 (verdict: 'weak'): Completely saturated, duplicate, or nonsensical premise."
)

CRITIQUE_PROMPT = """\
Claimed research gap: {description}

Evidence type: {evidence_type}
Number of supporting papers: {n_papers}
Supporting paper titles:
{paper_titles}

Evaluate this research gap. Return JSON with:
- "verdict": one of "strong", "plausible", "weak"
- "score": a float 0.0-1.0 (confidence that this is a genuine, actionable gap)
- "reasoning": 1-2 sentence justification for the verdict
"""


class CriticAgent:
    def __init__(self, llm: LLMClient | None = None):
        self.llm = llm or LLMClient()

    def critique(self, gap: CandidateGap, papers_by_id: dict[str, Paper]) -> CandidateGap:
        titles = "\n".join(
            f"- {papers_by_id[pid].title}" for pid in gap.related_paper_ids if pid in papers_by_id
        ) or "(none available)"

        prompt = CRITIQUE_PROMPT.format(
            description=gap.description,
            evidence_type=gap.evidence_type,
            n_papers=len(gap.related_paper_ids),
            paper_titles=titles,
        )
        data = self.llm.complete_json(prompt, system=SYSTEM_PROMPT)

        gap.critic_score = float(data.get("score", 0.5))
        gap.critic_verdict = data.get("verdict", "plausible")
        gap.raw_evidence["critic_reasoning"] = data.get("reasoning", "")
        return gap

    def critique_all(self, gaps: list[CandidateGap], papers_by_id: dict[str, Paper]) -> list[CandidateGap]:
        import time
        results = []
        total = len(gaps)
        for i, g in enumerate(gaps):
            logger.info("CriticAgent: critiquing gap %d/%d: %s", i + 1, total, g.description[:60])
            results.append(self.critique(g, papers_by_id))
            if i < total - 1:
                time.sleep(3.0)  # pace LLM calls
        return results
