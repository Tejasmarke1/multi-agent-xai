"""
ParserAgent — turns a Paper's PDF into usable text.

Full-text parsing meaningfully improves summarization quality (limitations /
future-work sections rarely show up in abstracts), but it's optional: if the
PDF can't be fetched, downstream agents fall back to abstract-only.
"""
from __future__ import annotations

import logging
import re
import gzip
from html.parser import HTMLParser
from urllib.parse import urlparse

import pymupdf
import requests

from schemas import Paper

logger = logging.getLogger(__name__)

SECTION_HEADERS = [
    "abstract", "introduction", "related work", "background", "method",
    "methodology", "approach", "experiments", "results", "discussion",
    "limitations", "future work", "conclusion",
]


class ParserAgent:
    def __init__(self, timeout: int = 5, max_chars: int = 20_000):
        self.timeout = timeout
        self.max_chars = max_chars

    # Known paywalled / anti-scraper domains that block direct PDF downloads
    _SKIP_DOMAINS = (
        "doi.org", "acs.org", "springer.com", "elsevier.com", "sciencedirect.com",
        "ieee.org", "acm.org", "wiley.com", "oup.com", "nature.com", "science.org",
        "cell.com", "mdpi.com", "frontiersin.org", "tandfonline.com"
    )

    def _should_skip(self, url: str) -> bool:
        """Return True if the URL is almost certainly not directly downloadable via simple GET."""
        # ArXiv PDFs are always open and fast
        if "arxiv.org" in url:
            return False

        parsed = urlparse(url)
        host = parsed.netloc.lower()

        if any(domain in host for domain in self._SKIP_DOMAINS):
            return True

        # Plain DOI links that don't end in .pdf
        if "doi.org" in host or ("doi.org/" in url and not url.endswith(".pdf")):
            return True

        return False

    def parse(self, paper: Paper) -> Paper:
        if not paper.url:
            return paper

        # Skip paywalled / non-PDF URLs immediately — saves ~2-4 s per paper
        # and eliminates the 403/text-html warning flood in the logs.
        if self._should_skip(paper.url):
            logger.debug(
                "ParserAgent: skipping non-PDF URL for %s (%s); using abstract only.",
                paper.paper_id, paper.url,
            )
            return paper

        try:
            pdf_bytes = self._download(paper.url)
            text = self._extract_text(pdf_bytes)
            paper.full_text = text[: self.max_chars]
        except Exception as exc:  # noqa: BLE001
            text = self._download_arxiv_source(paper.url)
            if text:
                paper.full_text = text[: self.max_chars]
                paper.url = self._abstract_url(paper.url)
                logger.info("ParserAgent: used arXiv source text for %s because PDF was unavailable.", paper.paper_id)
            else:
                if self._is_arxiv_url(paper.url):
                    paper.url = self._abstract_url(paper.url)
                logger.warning("ParserAgent: failed to parse %s (%s); using abstract only.", paper.paper_id, exc)
        return paper

    def _download(self, url: str) -> bytes:
        errors = []
        for candidate in self._download_candidates(url):
            try:
                resp = requests.get(
                    candidate,
                    timeout=self.timeout,
                    allow_redirects=True,
                    headers={
                        "Accept": "application/pdf,application/octet-stream;q=0.9,*/*;q=0.1",
                        "User-Agent": "multi-agent-xai/1.0 (research-paper-parser)",
                    },
                )
                resp.raise_for_status()
                content = resp.content
                if content.startswith(b"%PDF"):
                    return content
                errors.append(f"{candidate}: {resp.headers.get('content-type', 'unknown')}")
            except requests.RequestException as exc:
                errors.append(f"{candidate}: {exc}")
        raise ValueError("No downloadable PDF found; " + " | ".join(errors))

    @staticmethod
    def _download_candidates(url: str) -> list[str]:
        candidates = [url]
        parsed = urlparse(url)
        if parsed.netloc in {"arxiv.org", "export.arxiv.org"} and parsed.path.startswith("/pdf/"):
            identifier = parsed.path.removeprefix("/pdf/").removesuffix(".pdf")
            candidates = [
                f"https://arxiv.org/pdf/{identifier}.pdf",
                f"https://export.arxiv.org/pdf/{identifier}.pdf",
                f"https://arxiv.org/pdf/{identifier}",
            ]
        return list(dict.fromkeys(candidates))

    @staticmethod
    def _extract_text(pdf_bytes: bytes) -> str:
        with pymupdf.open(stream=pdf_bytes, filetype="pdf") as doc:
            text = "\n".join(page.get_text() for page in doc)
        cleaned = re.sub(r"\s+", " ", text).strip()
        if not cleaned:
            raise ValueError("PDF contains no extractable text")
        return cleaned

    def _download_arxiv_source(self, url: str) -> str:
        if not self._is_arxiv_url(url):
            return ""
        identifier = urlparse(url).path.split("/pdf/", 1)[-1].removesuffix(".pdf")
        try:
            response = requests.get(
                f"https://arxiv.org/e-print/{identifier}",
                timeout=self.timeout,
                headers={"User-Agent": "multi-agent-xai/1.0 (research-paper-parser)"},
            )
            response.raise_for_status()
            source = gzip.decompress(response.content)
            if source.lstrip().startswith(b"<html"):
                return _HTMLTextExtractor.extract(source.decode("utf-8", errors="ignore"))
        except Exception as exc:  # noqa: BLE001
            logger.debug("arXiv source fallback failed for %s: %s", identifier, exc)
        return ""

    @staticmethod
    def _is_arxiv_url(url: str) -> bool:
        return urlparse(url).netloc in {"arxiv.org", "export.arxiv.org"}

    @staticmethod
    def _abstract_url(url: str) -> str:
        parsed = urlparse(url)
        identifier = parsed.path.split("/pdf/", 1)[-1].removesuffix(".pdf")
        return f"https://arxiv.org/abs/{identifier}"

    @staticmethod
    def locate_section(text: str, section: str) -> str:
        """Best-effort heuristic slice of a named section out of raw full text."""
        pattern = re.compile(rf"\b{re.escape(section)}\b", re.IGNORECASE)
        match = pattern.search(text)
        if not match:
            return ""
        start = match.end()
        next_headers = [h for h in SECTION_HEADERS if h != section.lower()]
        end = len(text)
        for header in next_headers:
            m2 = re.search(rf"\b{re.escape(header)}\b", text[start:], re.IGNORECASE)
            if m2:
                end = min(end, start + m2.start())
        return text[start:end].strip()[:2000]


class _HTMLTextExtractor(HTMLParser):
    def __init__(self):
        super().__init__()
        self.parts: list[str] = []

    def handle_data(self, data: str) -> None:
        self.parts.append(data)

    @classmethod
    def extract(cls, html: str) -> str:
        parser = cls()
        parser.feed(html)
        return re.sub(r"\s+", " ", " ".join(parser.parts)).strip()
