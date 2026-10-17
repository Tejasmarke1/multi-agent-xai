# Multi-Agent XAI Research Gap Detector

A multi-agent system that pulls papers on a topic, summarizes them into a
structured schema, and detects **research gaps** using three independent,
triangulated evidence sources instead of a single LLM guess — then runs every
candidate gap through a critic agent and explains it in an evidence-grounded
(XAI) way.

## Why this isn't "just an LLM pipeline"

Most naive versions of this project ask an LLM "what's missing in this
literature?" and trust whatever comes back. This implementation is built
around **grounded, auditable evidence**:

| Layer | What it does | Why it's evidence, not a guess |
|---|---|---|
| **Embedding-sparsity** (`agents/embedding_space.py`) | SPECTER2 embeds every paper; k-NN density finds topically isolated papers | Quantitative — same principle as using SHAP to ground a black-box prediction instead of trusting it blindly |
| **Knowledge graph** (`agents/knowledge_graph.py`) | Builds a problem→method→dataset graph; queries for method/dataset pairs that are each well-studied but never combined | A structural, auditable graph query — not free-text reasoning |
| **Contradiction detection** (`agents/contradiction.py`) | Cross-encoder NLI model flags papers on similar problems reporting conflicting results | Flags real open disputes / replication gaps, which plain summarization pipelines miss entirely |
| **Critic agent** (`agents/critic.py`) | A second, independently-prompted LLM call actively tries to *reject* each candidate gap before it's ranked | Reduces hallucinated gaps — self-critique loop, not single-pass generation |
| **Explainer / XAI agent** (`agents/explainer.py`) | Turns the quantitative evidence above into prose, citing specific scores and papers — never inventing new claims | This is the actual "XAI" in the project name: explanations are assembled from verified evidence, not generated from scratch |
| **Scoring + calibration** (`scoring.py`) | Weighted composite of density/recency/citation-velocity/critic-confidence; includes a `calibrate_weights()` hook to refit weights from user 👍/👎 feedback | Makes ranking tunable and improvable over time, not a fixed heuristic |

## Architecture

```
retrieve (arXiv → OpenAlex fallback) → parse (PDF→text) → summarize (structured LLM extraction)
                                              │
                     ┌────────────────────────┼────────────────────────┐
                     ▼                        ▼                        ▼
          embed_and_cluster           build_graph              detect_contradictions
        (SPECTER2 + k-NN density)   (problem/method/dataset)   (cross-encoder NLI)
                     └────────────────────────┼────────────────────────┘
                                              ▼
                                          critique (skeptical LLM reviewer)
                                              ▼
                                            score (weighted composite)
                                              ▼
                                           explain (evidence-grounded XAI)
```

Orchestrated with **LangGraph** (`orchestrator.py`) — the three evidence
layers run as parallel branches that fan in to a single critique step, using
`operator.add` reducers on the shared state so parallel writes are merged
correctly instead of racing/overwriting each other (see `schemas.py`).

## Setup

```bash
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # then add your GOOGLE_API_KEY from Google AI Studio
```

## Run

CLI:
```bash
python orchestrator.py "explainable AI for code energy consumption"
```

Dashboard (recommended — lets you browse gaps, the knowledge graph, and give
feedback that feeds the calibration loop):
```bash
streamlit run dashboard.py
```

The pipeline runs even without `GOOGLE_API_KEY` set: retrieval,
embeddings, graph-building, and scoring all work locally; only the
LLM-dependent steps (summarization prose, gap descriptions, critique,
explanations) fall back to clearly-labeled offline placeholders.

## Project layout

```
config.py              tunable settings (models, thresholds, score weights)
llm_client.py           Google AI Studio / LangChain wrapper with offline fallback
schemas.py              Pydantic data contracts passed between agents
scoring.py               composite ranking + feedback-based calibration
orchestrator.py           LangGraph pipeline wiring
dashboard.py              Streamlit UI
agents/
  retriever.py            arXiv search with OpenAlex fallback
  parser.py                PDF → structured text
  summarizer.py             structured per-paper summaries
  embedding_space.py         SPECTER2 embeddings + density gap detection
  knowledge_graph.py          problem/method/dataset graph + missing-edge queries
  contradiction.py             NLI-based cross-paper contradiction detection
  gap_detector.py               synthesizes evidence into CandidateGap objects
  critic.py                      skeptical self-critique / verification
  explainer.py                    evidence-grounded XAI explanations
```

## Extending further

- **Citation velocity**: `Paper.citation_count` is wired into scoring but not
  populated yet — plug in the Semantic Scholar API in `retriever.py` to
  activate that signal.
- **More graph node types**: extend `knowledge_graph.py` beyond
  problem/method/dataset (e.g. add "evaluation metric" as a fourth node type)
  for finer-grained gap queries.
- **Calibration in production**: `scoring.calibrate_weights()` returns new
  weights from collected feedback — wire it to periodically rewrite
  `config.py` or an external weights file rather than requiring a manual copy.
