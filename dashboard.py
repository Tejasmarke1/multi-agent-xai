"""
Streamlit dashboard — run a topic through the pipeline, browse ranked gaps
with their evidence-grounded explanations, inspect the knowledge graph, and
submit useful/not-useful feedback that feeds scoring.calibrate_weights().

Run with:  streamlit run dashboard.py
"""
from __future__ import annotations

import json
import os
from pathlib import Path

import pandas as pd
import plotly.graph_objects as go
import streamlit as st

from orchestrator import ResearchGapPipeline
from scoring import calibrate_weights

FEEDBACK_PATH = Path(".cache/feedback.jsonl")
FEEDBACK_PATH.parent.mkdir(parents=True, exist_ok=True)


def _record_feedback(gap, label: int) -> None:
    row = {
        "density_score": gap.density_score,
        "recency_score": gap.recency_score,
        "citation_velocity_score": gap.citation_velocity_score,
        "critic_score": gap.critic_score,
        "label": label,
    }
    with FEEDBACK_PATH.open("a") as f:
        f.write(json.dumps(row) + "\n")


def _load_feedback() -> list[dict]:
    if not FEEDBACK_PATH.exists():
        return []
    with FEEDBACK_PATH.open() as f:
        return [json.loads(line) for line in f if line.strip()]

st.set_page_config(page_title="Multi-Agent XAI Gap Detector", layout="wide")
st.title("🔎 Multi-Agent XAI Research Gap Detector")
st.caption(
    "Retrieval → Summarization → [Embedding-sparsity | Knowledge-graph | Contradiction] "
    "→ Critique → Scoring → Explanation"
)

if not (os.getenv("GOOGLE_API_KEY") or os.getenv("GEMINI_API_KEY")):
    st.warning(
        "GOOGLE_API_KEY is not set — running in offline mode. Summaries/explanations "
        "will be placeholders. Set it in a `.env` file for real Google AI Studio reasoning.",
        icon="⚠️",
    )

with st.sidebar:
    st.header("Run settings")
    topic = st.text_input("Research topic", value="explainable AI for code energy consumption")
    max_results = st.slider("Max papers to retrieve", 10, 80, 30, step=5)
    run_btn = st.button("Run pipeline", type="primary")

if "state" not in st.session_state:
    st.session_state.state = None

if run_btn:
    with st.spinner(f"Running multi-agent pipeline for '{topic}'..."):
        pipeline = ResearchGapPipeline()
        pipeline.retriever.max_results = max_results
        st.session_state.state = pipeline.run(topic)

state = st.session_state.state

if state is None:
    st.info("Set a topic in the sidebar and click **Run pipeline** to get started.")
    st.stop()

tab_gaps, tab_graph, tab_papers, tab_log = st.tabs(
    ["📌 Ranked Gaps", "🕸️ Knowledge Graph", "📄 Papers", "🧾 Pipeline Log"]
)

# ---------------------------------------------------------------------- Gaps
with tab_gaps:
    st.subheader(f"{len(state.final_gaps)} candidate gaps for '{state.topic}'")

    if not state.final_gaps:
        st.warning("No gaps survived the critic's confidence threshold. Try a broader topic or more papers.")

    papers_by_id = {p.paper_id: p for p in state.papers}

    for gap in state.final_gaps:
        with st.container(border=True):
            col1, col2 = st.columns([5, 1])
            with col1:
                st.markdown(f"**{gap.description}**")
                st.caption(f"Evidence: `{gap.evidence_type}` · Critic verdict: **{gap.critic_verdict}**")
            with col2:
                st.metric("Score", f"{gap.final_score:.2f}")

            st.write(gap.explanation)

            score_cols = st.columns(4)
            score_cols[0].metric("Density", f"{gap.density_score:.2f}")
            score_cols[1].metric("Recency", f"{gap.recency_score:.2f}")
            score_cols[2].metric("Citation velocity", f"{gap.citation_velocity_score:.2f}")
            score_cols[3].metric("Critic confidence", f"{gap.critic_score:.2f}")

            with st.expander(f"Supporting papers ({len(gap.related_paper_ids)})"):
                for pid in gap.related_paper_ids:
                    p = papers_by_id.get(pid)
                    if p:
                        st.markdown(f"- [{p.title}]({p.url or '#'})")

            fb_cols = st.columns([1, 1, 6])
            if fb_cols[0].button("👍 Useful", key=f"up_{gap.gap_id}"):
                _record_feedback(gap, label=1)
                st.toast("Feedback recorded.")
            if fb_cols[1].button("👎 Not useful", key=f"down_{gap.gap_id}"):
                _record_feedback(gap, label=0)
                st.toast("Feedback recorded.")

# ---------------------------------------------------------------- Graph tab
with tab_graph:
    st.subheader("Problem → Method → Dataset knowledge graph")
    if not state.graph_nodes:
        st.info("No graph nodes yet.")
    else:
        df = pd.DataFrame([n.model_dump() for n in state.graph_nodes])
        st.dataframe(df[["node_type", "label", "paper_ids"]], use_container_width=True)

        counts = df["node_type"].value_counts()
        fig = go.Figure(data=[go.Bar(x=counts.index, y=counts.values)])
        fig.update_layout(title="Node counts by type", xaxis_title="Node type", yaxis_title="Count")
        st.plotly_chart(fig, use_container_width=True)

    if state.contradictions:
        st.subheader(f"⚔️ {len(state.contradictions)} contradiction(s) detected")
        st.dataframe(pd.DataFrame([c.model_dump() for c in state.contradictions]), use_container_width=True)

# ---------------------------------------------------------------- Papers tab
with tab_papers:
    st.subheader(f"{len(state.papers)} retrieved papers")
    df = pd.DataFrame([p.model_dump(exclude={"full_text"}) for p in state.papers])
    st.dataframe(df, use_container_width=True)

    st.subheader("Structured summaries")
    if state.summaries:
        st.dataframe(pd.DataFrame([s.model_dump() for s in state.summaries]), use_container_width=True)

# ---------------------------------------------------------------- Log tab
with tab_log:
    st.subheader("Agent execution log")
    for line in state.log:
        st.text(line)

    st.divider()
    st.subheader("Calibrate scoring weights from feedback")
    st.caption("Requires at least 10 upvote/downvote feedback rows saved to .cache/feedback.jsonl")
    if st.button("Recalibrate weights"):
        rows = _load_feedback()
        try:
            new_weights = calibrate_weights(rows)
            st.success("New weights (copy into config.Settings to apply):")
            st.json(new_weights)
        except ValueError as e:
            st.error(str(e))
