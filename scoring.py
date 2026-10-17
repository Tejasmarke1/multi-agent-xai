"""
Scoring & ranking — turns raw evidence signals into one final_score per gap,
and provides a hook to calibrate those weights against human feedback over time.

This is what turns the project from "LLM lists some gaps" into something with
a defensible, tunable ranking — a detail worth highlighting in interviews.
"""
from __future__ import annotations

import math
from datetime import datetime, timezone

import numpy as np

from config import SETTINGS
from schemas import CandidateGap, Paper


def _recency_score(paper_ids: list[str], papers_by_id: dict[str, Paper]) -> float:
    """Exponential decay recency score in [0, 1]; 1.0 = published today."""
    now = datetime.now(timezone.utc)
    scores = []
    for pid in paper_ids:
        paper = papers_by_id.get(pid)
        if not paper or not paper.published:
            continue
        try:
            published = datetime.fromisoformat(paper.published)
            if published.tzinfo is None:
                published = published.replace(tzinfo=timezone.utc)
        except ValueError:
            continue
        age_years = max((now - published).days / 365.25, 0.0)
        decay = math.exp(-math.log(2) * age_years / SETTINGS.recency_half_life_years)
        scores.append(decay)
    return float(np.mean(scores)) if scores else 0.5  # neutral if unknown


def _citation_velocity_score(paper_ids: list[str], papers_by_id: dict[str, Paper]) -> float:
    """
    Normalized citations-per-year. Requires Paper.citation_count to be populated
    (e.g. via Semantic Scholar API) — degrades gracefully to a neutral 0.5 if absent.
    """
    now_year = datetime.now(timezone.utc).year
    velocities = []
    for pid in paper_ids:
        paper = papers_by_id.get(pid)
        if not paper or paper.citation_count is None or not paper.published:
            continue
        try:
            pub_year = datetime.fromisoformat(paper.published).year
        except ValueError:
            continue
        years_active = max(now_year - pub_year, 1)
        velocities.append(paper.citation_count / years_active)
    if not velocities:
        return 0.5
    # squash with log + min-max against a reasonable ceiling (50 citations/yr) to keep in [0,1]
    squashed = [min(math.log1p(v) / math.log1p(50), 1.0) for v in velocities]
    return float(np.mean(squashed))


def score_gap(gap: CandidateGap, papers_by_id: dict[str, Paper]) -> CandidateGap:
    gap.density_score = gap.raw_evidence.get("density_score", 0.5 if gap.evidence_type != "embedding_sparsity" else 0.8)
    gap.recency_score = _recency_score(gap.related_paper_ids, papers_by_id)
    gap.citation_velocity_score = _citation_velocity_score(gap.related_paper_ids, papers_by_id)

    gap.final_score = (
        SETTINGS.weight_density * gap.density_score
        + SETTINGS.weight_recency * gap.recency_score
        + SETTINGS.weight_citation_velocity * gap.citation_velocity_score
        + SETTINGS.weight_critic * gap.critic_score
    )
    return gap


def score_all(gaps: list[CandidateGap], papers_by_id: dict[str, Paper]) -> list[CandidateGap]:
    return sorted((score_gap(g, papers_by_id) for g in gaps), key=lambda g: g.final_score, reverse=True)


# ---------------------------------------------------------------------------
# Calibration hook (novelty #6): once users rate suggested gaps as
# useful/not-useful, refit the weights above with a simple logistic
# regression over [density, recency, citation_velocity, critic_score] ->
# label. Kept separate from score_all so the pipeline runs without any
# feedback data collected yet.
# ---------------------------------------------------------------------------
def calibrate_weights(feedback_rows: list[dict]) -> dict[str, float]:
    """
    feedback_rows: list of {"density_score", "recency_score",
    "citation_velocity_score", "critic_score", "label"} where label is 1
    (useful gap) / 0 (not useful), collected from dashboard user feedback.

    Returns a new weight dict — wire this back into SETTINGS (or an
    overridable config file) to have the ranking improve over time.
    """
    from sklearn.linear_model import LogisticRegression

    if len(feedback_rows) < 10:
        raise ValueError("Need at least 10 labeled feedback rows to calibrate reliably.")

    X = np.array(
        [
            [r["density_score"], r["recency_score"], r["citation_velocity_score"], r["critic_score"]]
            for r in feedback_rows
        ]
    )
    y = np.array([r["label"] for r in feedback_rows])

    clf = LogisticRegression().fit(X, y)
    raw_weights = np.abs(clf.coef_[0])
    normalized = raw_weights / raw_weights.sum()

    return {
        "weight_density": float(normalized[0]),
        "weight_recency": float(normalized[1]),
        "weight_citation_velocity": float(normalized[2]),
        "weight_critic": float(normalized[3]),
    }
