"""
RetrieverAgent — pulls candidate papers from arXiv with an OpenAlex fallback.

`search()` is the only method other agents depend on, so source failures do
not affect the downstream pipeline.

arXiv 429 handling: The arXiv API rate-limits at roughly 1 request / 3 s
for unauthenticated clients.  When arXiv returns HTTP 429 we switch to the
OpenAlex fallback *immediately* instead of burning through num_retries.
"""
from __future__ import annotations

import json
import logging
import time
from urllib.parse import quote
from urllib.request import Request, urlopen

import arxiv

from config import SETTINGS
from schemas import Paper

logger = logging.getLogger(__name__)

# Minimum gap between successive arXiv API calls (seconds).
# The arXiv TOS recommends >= 3 s; we default to 10 in SETTINGS which is safer.
_ARXIV_MIN_DELAY = max(SETTINGS.arxiv_delay_seconds, 3.0)


class RetrieverAgent:
    def __init__(self, max_results: int | None = None):
        self.max_results = max_results or SETTINGS.arxiv_max_results
        self._client = arxiv.Client(
            page_size=min(self.max_results, 25),
            delay_seconds=_ARXIV_MIN_DELAY,
            num_retries=1,          # Fast fallback to OpenAlex if arXiv 503s or rate limits
        )

    def search(self, topic: str) -> list[Paper]:
        logger.info("RetrieverAgent: searching arXiv for %r", topic)
        sort_criterion = (
            arxiv.SortCriterion.SubmittedDate
            if SETTINGS.arxiv_sort_by == "submittedDate"
            else arxiv.SortCriterion.Relevance
        )
        search = arxiv.Search(
            query=self._normalize_query(topic),
            max_results=self.max_results,
            sort_by=sort_criterion,
        )

        papers: list[Paper] = []
        try:
            for result in self._client.results(search):
                papers.append(self._from_arxiv_result(result))
        except Exception as exc:  # noqa: BLE001
            exc_str = str(exc)
            if "429" in exc_str or "Too Many Requests" in exc_str:
                logger.warning(
                    "arXiv returned HTTP 429 (rate limited). "
                    "Switching immediately to OpenAlex fallback — no further arXiv retries."
                )
            else:
                logger.warning("arXiv search failed: %s", exc_str[:200])
            papers = []

        if not papers:
            logger.info("RetrieverAgent: trying OpenAlex fallback…")
            papers = self._search_openalex(topic)
            if papers:
                logger.info("RetrieverAgent: OpenAlex returned %d papers.", len(papers))
            else:
                logger.error("RetrieverAgent: both arXiv and OpenAlex returned no results.")

        logger.info("RetrieverAgent: found %d papers total", len(papers))
        return papers

    @staticmethod
    def _normalize_query(topic: str) -> str:
        return " ".join(topic.split()).strip()

    @staticmethod
    def _from_arxiv_result(result) -> Paper:
        paper_id = result.get_short_id()
        return Paper(
            paper_id=paper_id,
            title=result.title.strip(),
            abstract=result.summary.strip().replace("\n", " "),
            authors=[author.name for author in result.authors],
            published=result.published.isoformat() if result.published else None,
            # Direct PDF URL — arXiv always serves these without auth
            url=f"https://arxiv.org/pdf/{paper_id}.pdf",
        )

    def _search_openalex(self, topic: str) -> list[Paper]:
        url = (
            "https://api.openalex.org/works?search="
            f"{quote(self._normalize_query(topic))}&per-page={min(self.max_results, 50)}"
            "&select=id,title,doi,publication_date,authorships,abstract_inverted_index,open_access,primary_location"
            "&mailto=research-gap-detector@example.com"  # polite pool — higher rate limit
        )
        try:
            request = Request(url, headers={"User-Agent": "multi-agent-xai/1.0 (research-gap-detector)"})
            with urlopen(request, timeout=20) as response:  # noqa: S310
                payload = json.load(response)
        except Exception as exc:  # noqa: BLE001
            logger.error("OpenAlex fallback search failed: %s", exc)
            return []

        results = payload.get("results", [])
        papers = [self._from_openalex_result(r) for r in results]

        # Log breakdown for transparency
        arxiv_count = sum(1 for p in papers if p.url and "arxiv" in (p.url or "").lower())
        logger.info(
            "OpenAlex: %d papers (%d with arXiv PDF links, %d DOI-only)",
            len(papers), arxiv_count, len(papers) - arxiv_count,
        )
        return papers

    @staticmethod
    def _from_openalex_result(result: dict) -> Paper:
        # Reconstruct abstract from inverted index
        abstract_index = result.get("abstract_inverted_index") or {}
        if abstract_index:
            words_with_pos = [
                (pos, word)
                for word, positions in abstract_index.items()
                for pos in positions
            ]
            abstract = " ".join(w for _, w in sorted(words_with_pos))
        else:
            abstract = ""

        authors = [
            author.get("author", {}).get("display_name", "")
            for author in result.get("authorships", [])
        ]

        open_access = result.get("open_access") or {}
        primary_location = result.get("primary_location") or {}

        # Prefer direct arXiv PDF over a DOI (DOIs almost never serve raw PDFs)
        oa_url = open_access.get("oa_url") or ""
        pdf_url = primary_location.get("pdf_url") or ""
        doi = result.get("doi") or ""

        # Pick best URL: arXiv PDF > any direct PDF > DOI (last resort, rarely parseable)
        if "arxiv.org/pdf" in (pdf_url + oa_url).lower():
            best_url = next(u for u in [pdf_url, oa_url] if "arxiv.org/pdf" in u.lower())
        elif pdf_url:
            best_url = pdf_url
        elif oa_url:
            best_url = oa_url
        else:
            best_url = doi  # parser will fail gracefully and use abstract only

        return Paper(
            paper_id=doi or result.get("id", "").rsplit("/", 1)[-1],
            title=(result.get("title") or "Untitled paper").strip(),
            abstract=abstract,
            authors=[a for a in authors if a],
            published=result.get("publication_date"),
            url=best_url or None,
        )
