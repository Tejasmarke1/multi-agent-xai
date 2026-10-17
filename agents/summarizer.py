"""
SummarizerAgent — converts each Paper into a structured PaperSummary
(problem / method / dataset / result / limitations / contribution).

Structured (not free-text) summaries are what let downstream agents build a
knowledge graph and run programmatic gap queries instead of re-reading prose.
"""
from __future__ import annotations

import logging

from llm_client import LLMClient
from schemas import Paper, PaperSummary

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = (
    "You are a meticulous research analyst. You extract structured, factual "
    "information from academic papers. Never invent details not supported by "
    "the text. If something isn't stated, say 'not specified'."
)

PROMPT_TEMPLATE = """\
Extract a structured summary of the following paper.

Title: {title}
Abstract: {abstract}
{full_text_block}

Return JSON with exactly these keys:
- problem: the research problem being addressed (1 sentence)
- method: the core technical method/approach (1-2 sentences)
- dataset: dataset(s) or benchmark(s) used (or "not specified")
- key_result: the headline quantitative or qualitative result (1 sentence)
- limitations: stated or clearly implied limitations (1-2 sentences, or "not specified")
- claimed_contribution: what the authors claim is novel (1 sentence)
"""


class SummarizerAgent:
    def __init__(self, llm: LLMClient | None = None):
        self.llm = llm or LLMClient()

    def summarize(self, paper: Paper) -> PaperSummary:
        full_text_block = ""
        if paper.full_text:
            full_text_block = f"\nAdditional full-text excerpt:\n{paper.full_text[:6000]}"

        prompt = PROMPT_TEMPLATE.format(
            title=paper.title, abstract=paper.abstract, full_text_block=full_text_block
        )
        data = self.llm.complete_json(prompt, system=SYSTEM_PROMPT)

        return PaperSummary(
            paper_id=paper.paper_id,
            problem=data.get("problem", "not specified"),
            method=data.get("method", "not specified"),
            dataset=data.get("dataset", "not specified"),
            key_result=data.get("key_result", "not specified"),
            limitations=data.get("limitations", "not specified"),
            claimed_contribution=data.get("claimed_contribution", "not specified"),
        )

    def summarize_all(self, papers: list[Paper]) -> list[PaperSummary]:
        summaries = []
        total = len(papers)
        # Small delay between calls to stay within Gemini free-tier rate limits.
        # gemini-2.5-flash allows ~15 RPM on the free tier; ~4 s gap is safe.
        _INTER_CALL_DELAY = 4.0

        for i, p in enumerate(papers):
            try:
                logger.info("SummarizerAgent: summarizing paper %d/%d (%s)", i + 1, total, p.paper_id)
                summaries.append(self.summarize(p))
            except Exception as exc:  # noqa: BLE001
                logger.warning("SummarizerAgent: failed on %s (%s)", p.paper_id, exc)

            # Pace calls — skip delay after the last paper
            if i < total - 1:
                import time
                time.sleep(_INTER_CALL_DELAY)

        logger.info("SummarizerAgent: completed %d/%d summaries.", len(summaries), total)
        return summaries
