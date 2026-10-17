"""
EmbeddingSpaceAgent — the first "novelty" layer.

Instead of trusting an LLM's free-text claim that "X is understudied", this
agent embeds every paper (title+abstract, SPECTER2 — trained specifically on
citation graphs, so distances correlate with topical/citation relatedness)
and computes a local density estimate for each paper via k-NN distance.

Papers sitting in *sparse* regions of embedding space are quantitative
evidence of an under-explored area — this becomes grounding evidence that the
GapDetectorAgent and ExplainerAgent can cite, instead of hallucinating.
"""
from __future__ import annotations

import logging

import numpy as np
from sklearn.neighbors import NearestNeighbors

from config import SETTINGS
from schemas import Paper

logger = logging.getLogger(__name__)


class EmbeddingSpaceAgent:
    def __init__(self, model_name: str | None = None):
        self.model_name = model_name or SETTINGS.embedding_model
        self._model = self._load_model(self.model_name)

    def _load_model(self, name: str):
        import os
        from sentence_transformers import SentenceTransformer

        # Disable symlink and unauthenticated warnings from huggingface_hub
        os.environ.setdefault("HF_HUB_DISABLE_SYMLINKS_WARNING", "1")

        # Try loading cached local files first (instant startup, no HF network calls)
        try:
            return SentenceTransformer(name, local_files_only=True)
        except Exception:
            pass

        try:
            return SentenceTransformer(name)
        except Exception as exc:  # noqa: BLE001
            logger.warning("Could not load %s (%s); falling back to %s", name, exc, SETTINGS.embedding_fallback_model)
            try:
                return SentenceTransformer(SETTINGS.embedding_fallback_model, local_files_only=True)
            except Exception:
                return SentenceTransformer(SETTINGS.embedding_fallback_model)

    def embed_papers(self, papers: list[Paper]) -> dict[str, np.ndarray]:
        texts = [f"{p.title}. {p.abstract}" for p in papers]
        vectors = self._model.encode(texts, normalize_embeddings=True, show_progress_bar=False)
        return {p.paper_id: vec for p, vec in zip(papers, vectors)}

    def compute_density_scores(self, embeddings: dict[str, np.ndarray]) -> dict[str, float]:
        """
        Returns paper_id -> density_score in [0, 1], where HIGHER means SPARSER
        (i.e. more isolated / more likely to sit in an under-explored region).
        """
        ids = list(embeddings.keys())
        matrix = np.vstack([embeddings[i] for i in ids])
        k = min(SETTINGS.embedding_density_k, len(ids) - 1)
        if k < 1:
            return {i: 0.0 for i in ids}

        nn = NearestNeighbors(n_neighbors=k + 1, metric="cosine").fit(matrix)
        distances, _ = nn.kneighbors(matrix)
        mean_knn_dist = distances[:, 1:].mean(axis=1)  # exclude self (distance 0)

        # normalize to [0, 1]
        lo, hi = mean_knn_dist.min(), mean_knn_dist.max()
        span = hi - lo if hi > lo else 1.0
        normalized = (mean_knn_dist - lo) / span
        return dict(zip(ids, normalized.tolist()))

    def sparse_region_clusters(
        self, embeddings: dict[str, np.ndarray], density_scores: dict[str, float]
    ) -> list[list[str]]:
        """
        Groups the sparsest papers into small clusters — each cluster represents
        a candidate "unexplored intersection" for the GapDetectorAgent to reason
        about, rather than treating every sparse paper independently.
        """
        threshold = np.percentile(list(density_scores.values()), SETTINGS.density_gap_percentile)
        sparse_ids = [pid for pid, score in density_scores.items() if score >= threshold]
        if len(sparse_ids) < 2:
            return [[pid] for pid in sparse_ids]

        from sklearn.cluster import AgglomerativeClustering

        sub_matrix = np.vstack([embeddings[i] for i in sparse_ids])
        n_clusters = max(1, min(4, len(sparse_ids) // 2))
        if n_clusters == 1 and len(sparse_ids) >= 3:
            n_clusters = 2

        try:
            labels = AgglomerativeClustering(n_clusters=n_clusters, metric="cosine", linkage="average").fit_predict(
                sub_matrix
            )
            clusters: dict[int, list[str]] = {}
            for pid, label in zip(sparse_ids, labels):
                clusters.setdefault(label, []).append(pid)
            return list(clusters.values())
        except Exception:
            return [[pid] for pid in sparse_ids]

