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
        if self._model is None or len(summaries) < 2:
            return []

        import numpy as np

        # Compare papers that plausibly address related problems
        candidate_pairs = [
            (a, b)
            for a, b in itertools.combinations(summaries, 2)
            if self._same_problem_space(a.problem, b.problem)
        ]
        # Fallback: if lexical filter found nothing, compare adjacent summaries
        if not candidate_pairs:
            candidate_pairs = list(itertools.combinations(summaries[:10], 2))

        if not candidate_pairs:
            return []

        # Keep max 50 pairs for inference performance
        candidate_pairs = candidate_pairs[:50]
        sentence_pairs = [(a.key_result, b.key_result) for a, b in candidate_pairs if a.key_result and b.key_result]
        if not sentence_pairs:
            return []

        # CrossEncoder NLI models output raw logits [contradiction, entailment, neutral]
        raw_scores = self._model.predict(sentence_pairs)
        # Apply numerically stable softmax to get true probabilities
        exp_scores = np.exp(raw_scores - np.max(raw_scores, axis=-1, keepdims=True))
        probs = exp_scores / exp_scores.sum(axis=-1, keepdims=True)

        results: list[Contradiction] = []
        for (a, b), prob_row in zip(candidate_pairs, probs):
            contradiction_prob = float(prob_row[0])
            if contradiction_prob >= self.threshold:
                results.append(
                    Contradiction(
                        paper_id_a=a.paper_id,
                        paper_id_b=b.paper_id,
                        claim_a=a.key_result,
                        claim_b=b.key_result,
                        contradiction_score=round(contradiction_prob, 3),
                        explanation=(
                            f"Papers report empirical findings that the NLI cross-encoder model identifies as "
                            f"contradictory ({contradiction_prob:.1%} confidence), indicating an open dispute or replication gap."
                        ),
                    )
                )
        return results

    @staticmethod
    def _same_problem_space(problem_a: str, problem_b: str) -> bool:
        """Lexical overlap filter to find papers in related sub-domains."""
        stopwords = {"about", "which", "their", "there", "these", "those", "using", "based", "paper", "study", "approach", "model"}
        words_a = set(w.lower() for w in problem_a.split() if len(w) > 3 and w.lower() not in stopwords)
        words_b = set(w.lower() for w in problem_b.split() if len(w) > 3 and w.lower() not in stopwords)
        if not words_a or not words_b:
            return False
        overlap = len(words_a & words_b) / min(len(words_a), len(words_b))
        return overlap >= 0.15
