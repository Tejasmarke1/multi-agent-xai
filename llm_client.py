"""
Direct wrapper around Google GenAI SDK (google.genai).

Every agent that needs reasoning (summarization, critique, explanation)
goes through this client:
  - calls google.genai directly without LangChain middleware overhead or AFC warnings
  - uses types.GenerateContentConfig with response_mime_type="application/json" for clean JSON
  - includes robust exponential backoff on transient errors (429, 503)
  - falls back to offline stub if no key is configured
"""
from __future__ import annotations

import json
import logging
import random
import time
from typing import Any

from config import SETTINGS

logger = logging.getLogger(__name__)

try:
    from google import genai
    from google.genai import types
except ImportError:  # pragma: no cover
    genai = None
    types = None

# Errors that are transient and worth retrying
_RETRYABLE = (
    "429", "500", "503", "UNAVAILABLE", "Resource has been exhausted",
    "rate limit", "quota", "overloaded", "high demand"
)

_RETRY_DELAYS = [3, 8, 20]


class LLMClient:
    """Direct Google GenAI client for structured text and JSON generation."""

    def __init__(self, model: str | None = None):
        self.model = model or SETTINGS.llm_model
        self.available = genai is not None and bool(SETTINGS.google_api_key)
        self._client = None
        if self.available:
            try:
                self._client = genai.Client(api_key=SETTINGS.google_api_key)
                logger.info("LLMClient initialized with Google GenAI (model=%s)", self.model)
            except Exception as exc:
                logger.warning("Could not initialize genai.Client: %s", exc)
                self.available = False
        else:
            logger.warning("LLMClient: running in offline mode (no API key).")

    def complete(self, prompt: str, system: str | None = None, max_tokens: int | None = None) -> str:
        if not self.available or self._client is None:
            return self._offline_stub(prompt)

        tokens = max_tokens or SETTINGS.llm_max_tokens
        config = types.GenerateContentConfig(
            system_instruction=system or "You are a precise, technical research assistant.",
            max_output_tokens=tokens,
            temperature=SETTINGS.llm_temperature,
        )

        for attempt, delay in enumerate(_RETRY_DELAYS):
            try:
                chat = self._client.chats.create(model=self.model, config=config)
                response = chat.send_message(prompt)
                text = response.text or ""
                return text.strip()

            except Exception as exc:  # noqa: BLE001
                exc_str = str(exc)
                is_retryable = any(tok in exc_str for tok in _RETRYABLE)

                if is_retryable and attempt < len(_RETRY_DELAYS) - 1:
                    jitter = random.uniform(0.5, 2.0)
                    wait = delay + jitter
                    logger.warning(
                        "LLM call failed (attempt %d/%d, retrying in %.1fs): %s",
                        attempt + 1, len(_RETRY_DELAYS), wait, exc_str[:120]
                    )
                    time.sleep(wait)
                    continue

                logger.warning("LLM call failed after %d attempt(s); using offline stub. Error: %s",
                               attempt + 1, exc_str[:200])
                return self._offline_stub(prompt)

        return self._offline_stub(prompt)

    def complete_json(self, prompt: str, system: str | None = None, max_tokens: int | None = None) -> dict[str, Any]:
        """Request structured JSON and parse defensively."""
        if not self.available or self._client is None:
            return self._safe_json_parse(self._offline_stub(prompt))

        tokens = max_tokens or SETTINGS.llm_max_tokens
        config = types.GenerateContentConfig(
            system_instruction=(system or "You are a precise research assistant.") +
                               " You must output valid JSON only.",
            max_output_tokens=tokens,
            response_mime_type="application/json",
            temperature=SETTINGS.llm_temperature,
        )

        for attempt, delay in enumerate(_RETRY_DELAYS):
            try:
                chat = self._client.chats.create(model=self.model, config=config)
                response = chat.send_message(prompt)
                raw_text = response.text or "{}"
                return self._safe_json_parse(raw_text)

            except Exception as exc:  # noqa: BLE001
                exc_str = str(exc)
                is_retryable = any(tok in exc_str for tok in _RETRYABLE)

                if is_retryable and attempt < len(_RETRY_DELAYS) - 1:
                    jitter = random.uniform(0.5, 2.0)
                    wait = delay + jitter
                    logger.warning(
                        "LLM JSON call failed (attempt %d/%d, retrying in %.1fs): %s",
                        attempt + 1, len(_RETRY_DELAYS), wait, exc_str[:120]
                    )
                    time.sleep(wait)
                    continue

                logger.warning("LLM JSON call failed after %d attempt(s): %s", attempt + 1, exc_str[:200])
                return {}

        return {}

    @staticmethod
    def _safe_json_parse(raw: str) -> dict[str, Any]:
        cleaned = raw.strip()
        if cleaned.startswith("```"):
            lines = cleaned.split("\n")
            cleaned = "\n".join(lines[1:-1] if lines[-1].strip() == "```" else lines[1:])
        try:
            return json.loads(cleaned)
        except json.JSONDecodeError:
            start, end = cleaned.find("{"), cleaned.rfind("}")
            if start != -1 and end != -1:
                try:
                    return json.loads(cleaned[start: end + 1])
                except json.JSONDecodeError:
                    pass
            logger.warning("Could not parse LLM JSON output; returning empty dict. Raw: %s", cleaned[:200])
            return {}

    @staticmethod
    def _offline_stub(prompt: str) -> str:
        return (
            "[OFFLINE MODE — no Google AI Studio API key set. This is a placeholder response. "
            "Set GOOGLE_API_KEY in your .env to get real LLM reasoning.]"
        )
