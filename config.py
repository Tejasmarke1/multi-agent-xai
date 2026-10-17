"""
Central configuration for the Multi-Agent XAI Research Gap Detection system.
All tunables live here so agents stay free of magic numbers.
"""
from __future__ import annotations

import os
from dataclasses import dataclass, field

from dotenv import load_dotenv

load_dotenv()


@dataclass(frozen=True)
class Settings:
    # --- LLM ---
    google_api_key: str = field(
        default_factory=lambda: os.getenv("GOOGLE_API_KEY") or os.getenv("GEMINI_API_KEY", "")
    )
    llm_model: str = field(default_factory=lambda: os.getenv("LLM_MODEL", "gemini-3.5-flash-lite"))
    llm_max_tokens: int = 2048
    llm_temperature: float = 0.2

    # --- Embeddings ---
    # SPECTER2 is purpose-built for scientific paper embeddings (trained on citation graphs).
    embedding_model: str = "allenai/specter2_base"
    embedding_fallback_model: str = "all-MiniLM-L6-v2"  # used if specter2 can't be downloaded

    # --- NLI / contradiction detection ---
    nli_model: str = "cross-encoder/nli-deberta-v3-base"

    # --- Retrieval ---
    arxiv_max_results: int = 40
    arxiv_sort_by: str = "relevance"  # or "submittedDate"
    arxiv_delay_seconds: float = field(default_factory=lambda: float(os.getenv("ARXIV_DELAY_SECONDS", "10")))

    # --- Knowledge graph ---
    graph_similarity_threshold: float = 0.72  # cosine sim above which two papers are "related"

    # --- Gap detection ---
    embedding_density_k: int = 5          # k-NN used for local density estimate
    density_gap_percentile: float = 85.0  # papers below this density percentile flag sparse regions
    min_gap_confidence: float = 0.4

    # --- Scoring / ranking ---
    recency_half_life_years: float = 3.0  # exponential decay for recency weighting
    weight_density: float = 0.35
    weight_recency: float = 0.20
    weight_citation_velocity: float = 0.20
    weight_critic: float = 0.25

    # --- Storage ---
    cache_dir: str = ".cache"
    vector_store_path: str = ".cache/vector_store"


SETTINGS = Settings()
