"""
ContradictionAgent — the third "novelty" layer.

Runs pairwise NLI (natural language inference) between papers' key_result /
claimed_contribution statements. Cross-encoder NLI models output
entailment/neutral/contradiction probabilities — a high "contradiction"
score between two papers tackling a similar problem is strong, checkable
evidence of either (a) an open empirical dispute, or (b) a gap in replication
— both genuinely useful things to surface, and something plain LLM
summarization pipelines almost never do.
"""
from __future__ import annotations

import itertools
import logging

from config import SETTINGS
from schemas import Contradiction, PaperSummary

logger = logging.getLogger(__name__)


class ContradictionAgent:
    def __init__(self, model_name: str | None = None, threshold: float = 0.6):
        self.model_name = model_name or SETTINGS.nli_model
        self.threshold = threshold
        self._model = self._load_model()

    def _load_model(self):
        import sys
        import warnings
        from sentence_transformers import CrossEncoder

        try:
            # Try loading cached local files first (instant startup, no HF network calls)
            with warnings.catch_warnings():
                warnings.filterwarnings("ignore", category=FutureWarning, module="torch")
                try:
                    return CrossEncoder(self.model_name, local_files_only=True)
                except Exception:
                    return CrossEncoder(self.model_name)
        except Exception as exc:  # noqa: BLE001
            logger.warning(
                "Could not load NLI model %s (%s); contradiction detection disabled.",
                self.model_name, exc,
            )
            return None

    def find_contradictions(self, summaries: list[PaperSummary]) -> list[Contradiction]:
        if self._model is None:
            return []

        # Only compare papers that plausibly address the same problem to keep
        # this O(n^2) step tractable and to avoid meaningless cross-topic "contradictions".
        candidate_pairs = [
            (a, b)
            for a, b in itertools.combinations(summaries, 2)
            if self._same_problem_space(a.problem, b.problem)
        ]
        if not candidate_pairs:
            return []

        sentence_pairs = [(a.key_result, b.key_result) for a, b in candidate_pairs]
        # CrossEncoder NLI models typically output [contradiction, entailment, neutral]
        scores = self._model.predict(sentence_pairs)

        results: list[Contradiction] = []
        for (a, b), score_row in zip(candidate_pairs, scores):
            contradiction_score = float(score_row[0])
            if contradiction_score >= self.threshold:
                results.append(
                    Contradiction(
                        paper_id_a=a.paper_id,
                        paper_id_b=b.paper_id,
                        claim_a=a.key_result,
                        claim_b=b.key_result,
                        contradiction_score=contradiction_score,
                        explanation=(
                            f"Papers address a similar problem ('{a.problem[:60]}...') but report "
                            f"results the NLI model scores as contradictory ({contradiction_score:.2f})."
                        ),
                    )
                )
        return results

    @staticmethod
    def _same_problem_space(problem_a: str, problem_b: str) -> bool:
        """Cheap lexical overlap filter before the expensive NLI pass."""
        words_a = set(w.lower() for w in problem_a.split() if len(w) > 4)
        words_b = set(w.lower() for w in problem_b.split() if len(w) > 4)
        if not words_a or not words_b:
            return False
        overlap = len(words_a & words_b) / min(len(words_a), len(words_b))
        return overlap >= 0.25
