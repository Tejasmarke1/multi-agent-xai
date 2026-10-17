"""
FastAPI backend for the Multi-Agent XAI Research Gap Pipeline.

Endpoints:
  GET  /                  - Health check
  GET  /health            - Detailed health/status info
  POST /run               - Start pipeline run (async, returns job_id)
  GET  /status/{job_id}   - Poll job status and result
  POST /feedback          - Save user feedback row
  POST /calibrate         - Re-calibrate scoring weights from feedback
  GET  /feedback/count    - Number of stored feedback rows
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import signal
import uuid
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any, Dict, Optional

import uvicorn
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# App setup
# ---------------------------------------------------------------------------

app = FastAPI(
    title="Multi-Agent XAI API",
    description="Backend for the Multi-Agent Explainable AI Research Gap Pipeline",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000", "*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# Shared state
# ---------------------------------------------------------------------------

# In-memory job store: job_id -> {"status": str, "progress": str, "result": dict|None, "error": str|None}
_jobs: Dict[str, Dict[str, Any]] = {}

# Single-worker executor — one pipeline at a time to avoid OOM from duplicate model loads
_executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="pipeline")

# Feedback file path
FEEDBACK_PATH = Path(".cache") / "feedback.jsonl"

# ---------------------------------------------------------------------------
# Request / Response schemas
# ---------------------------------------------------------------------------


class RunRequest(BaseModel):
    topic: str
    max_results: int = 30


class FeedbackRow(BaseModel):
    gap_id: str
    density_score: float
    recency_score: float
    citation_velocity_score: float
    critic_score: float
    label: int


# ---------------------------------------------------------------------------
# Helper: run pipeline in background thread with step-level progress updates
# ---------------------------------------------------------------------------

# Step labels shown in the UI progress field
_STEP_LABELS = {
    "retrieve": "Retrieving papers from arXiv / OpenAlex…",
    "parse": "Parsing PDFs → text…",
    "summarize": "Summarizing papers with LLM…",
    "embed_and_cluster": "Running embedding sparsity analysis…",
    "build_graph": "Building knowledge graph…",
    "detect_contradictions": "Detecting contradictions (NLI)…",
    "critique": "Running critic agent…",
    "score": "Scoring and ranking gaps…",
    "explain": "Generating XAI explanations…",
}


def _patched_pipeline(job_id: str, topic: str, max_results: int) -> None:
    """
    Runs ResearchGapPipeline with per-node progress updates written to _jobs.
    Monkey-patches each node method to set a progress string before execution.
    """
    try:
        _jobs[job_id]["status"] = "running"
        _jobs[job_id]["progress"] = "Initializing models…"

        from orchestrator import ResearchGapPipeline

        pipeline = ResearchGapPipeline()
        pipeline.retriever.max_results = max_results

        # Wrap each node method to update progress
        for node_name, label in _STEP_LABELS.items():
            original = getattr(pipeline, f"_n_{node_name}", None)
            if original is None:
                continue

            def make_wrapper(fn, lbl, nid):
                def wrapper(state):
                    _jobs[job_id]["progress"] = lbl
                    result = fn(state)
                    # After each step, append to a running log list
                    if "log_live" not in _jobs[job_id]:
                        _jobs[job_id]["log_live"] = []
                    if result and "log" in result:
                        _jobs[job_id]["log_live"].extend(result.get("log", []))
                    return result
                return wrapper

            setattr(pipeline, f"_n_{node_name}", make_wrapper(original, label, node_name))

        _jobs[job_id]["progress"] = f"Starting pipeline for: {topic!r}"
        state = pipeline.run(topic)

        _jobs[job_id]["status"] = "done"
        _jobs[job_id]["progress"] = f"Complete — {len(state.final_gaps)} gap(s) found"
        _jobs[job_id]["result"] = state.model_dump()

    except Exception as exc:
        logger.exception("Pipeline failed for job %s", job_id)
        _jobs[job_id]["status"] = "error"
        _jobs[job_id]["progress"] = f"Error: {exc}"
        _jobs[job_id]["error"] = str(exc)
        _jobs[job_id]["result"] = None


# ---------------------------------------------------------------------------
# Lifecycle: clean shutdown of the executor
# ---------------------------------------------------------------------------

@app.on_event("startup")
async def startup_event():
    logger.info("XAI API started — executor ready (max_workers=1)")


@app.on_event("shutdown")
async def shutdown_event():
    """
    Gracefully shut down the thread pool.
    wait=False lets uvicorn exit cleanly even if a pipeline job is mid-flight.
    """
    logger.info("Shutting down executor…")
    _executor.shutdown(wait=False, cancel_futures=True)
    logger.info("Executor shut down.")


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@app.get("/")
def root() -> Dict[str, str]:
    return {"status": "ok", "message": "Multi-Agent XAI API"}


@app.get("/health")
def health() -> Dict[str, Any]:
    total_jobs = len(_jobs)
    running = sum(1 for j in _jobs.values() if j["status"] == "running")
    done = sum(1 for j in _jobs.values() if j["status"] == "done")
    error = sum(1 for j in _jobs.values() if j["status"] == "error")

    feedback_count = 0
    if FEEDBACK_PATH.exists():
        with FEEDBACK_PATH.open("r", encoding="utf-8") as fh:
            feedback_count = sum(1 for line in fh if line.strip())

    return {
        "status": "ok",
        "jobs": {"total": total_jobs, "running": running, "done": done, "error": error},
        "feedback_rows": feedback_count,
    }


@app.post("/run")
async def run_pipeline_endpoint(request: RunRequest) -> Dict[str, str]:
    """
    Submit a pipeline run. Returns job_id immediately; poll /status/{job_id}.
    Uses asyncio.get_event_loop().run_in_executor() so the pipeline thread is
    properly tied to the event loop (avoids the BackgroundTasks + executor
    double-indirection that caused the shutdown KeyboardInterrupt).
    """
    topic = request.topic.strip()
    if not topic:
        raise HTTPException(status_code=400, detail="topic must not be empty")

    job_id = str(uuid.uuid4())
    _jobs[job_id] = {
        "status": "queued",
        "progress": "Queued — waiting for pipeline slot…",
        "result": None,
        "error": None,
        "log_live": [],
    }

    loop = asyncio.get_event_loop()
    loop.run_in_executor(_executor, _patched_pipeline, job_id, topic, request.max_results)

    return {"job_id": job_id}


@app.get("/status/{job_id}")
def get_status(job_id: str) -> Dict[str, Any]:
    if job_id not in _jobs:
        raise HTTPException(status_code=404, detail=f"Job '{job_id}' not found.")

    job = _jobs[job_id]
    return {
        "status": job["status"],
        "progress": job["progress"],
        "result": job["result"],
        "error": job.get("error"),
        "log_live": job.get("log_live", []),
    }


@app.post("/feedback")
def save_feedback(row: FeedbackRow) -> Dict[str, str]:
    try:
        FEEDBACK_PATH.parent.mkdir(parents=True, exist_ok=True)
        with FEEDBACK_PATH.open("a", encoding="utf-8") as fh:
            fh.write(row.model_dump_json() + "\n")
        return {"status": "saved", "gap_id": row.gap_id}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to save feedback: {exc}") from exc


@app.post("/calibrate")
def calibrate() -> Dict[str, Any]:
    try:
        if not FEEDBACK_PATH.exists():
            raise HTTPException(status_code=400, detail="No feedback data found. Submit feedback first.")

        feedback_rows: list[dict] = []
        with FEEDBACK_PATH.open("r", encoding="utf-8") as fh:
            for line in fh:
                line = line.strip()
                if line:
                    feedback_rows.append(json.loads(line))

        if not feedback_rows:
            raise HTTPException(status_code=400, detail="Feedback file is empty.")

        from scoring import calibrate_weights

        new_weights = calibrate_weights(feedback_rows)
        return {"status": "calibrated", "weights": new_weights, "rows_used": len(feedback_rows)}
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Calibration failed: {exc}") from exc


@app.get("/feedback/count")
def feedback_count() -> Dict[str, int]:
    if not FEEDBACK_PATH.exists():
        return {"count": 0}
    try:
        with FEEDBACK_PATH.open("r", encoding="utf-8") as fh:
            return {"count": sum(1 for line in fh if line.strip())}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Could not read feedback file: {exc}") from exc


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    )
    uvicorn.run(
        app,
        host="0.0.0.0",
        port=8000,
        # Let uvicorn handle SIGINT/SIGTERM gracefully
        timeout_graceful_shutdown=5,
    )
