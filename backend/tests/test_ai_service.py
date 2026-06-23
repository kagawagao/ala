"""Tests for AI service — mocked OpenAI/Anthropic endpoints."""

import tempfile
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

try:
    from ala.services.ai_service import (
        AIService,
        _is_anthropic_endpoint,
        _safe_repr,
    )
except ImportError:
    pytest.skip("anthropic not installed", allow_module_level=True)

# Static method extracted for convenience
_extract_system = AIService._extract_system

# ---------------------------------------------------------------------------
# Static / helper tests
# ---------------------------------------------------------------------------


class TestIsAnthropicEndpoint:
    def test_official_endpoint(self):
        assert _is_anthropic_endpoint("https://api.anthropic.com") is True

    def test_official_with_path(self):
        assert _is_anthropic_endpoint("https://api.anthropic.com/v1/messages") is True

    def test_subdomain_endpoint(self):
        assert _is_anthropic_endpoint("https://api.anthropic.com") is True

    def test_non_https_rejected(self):
        assert _is_anthropic_endpoint("http://api.anthropic.com") is False

    def test_other_host_not_detected(self):
        assert _is_anthropic_endpoint("https://api.openai.com") is False

    def test_query_string_bypass_rejected(self):
        # Should not be fooled by anthropic.com in query string
        assert _is_anthropic_endpoint("https://evil.com?q=anthropic.com") is False

    def test_empty_string(self):
        assert _is_anthropic_endpoint("") is False


class TestExtractSystem:
    def test_extracts_system_message(self):
        messages = [
            {"role": "system", "content": "You are helpful."},
            {"role": "user", "content": "Hello"},
        ]
        system_text, remaining = _extract_system(messages)
        assert system_text == "You are helpful."
        assert len(remaining) == 1
        assert remaining[0]["role"] == "user"

    def test_no_system_message(self):
        messages = [{"role": "user", "content": "Hello"}]
        system_text, remaining = _extract_system(messages)
        assert system_text is None
        assert len(remaining) == 1

    def test_multiple_system_messages_uses_last(self):
        messages = [
            {"role": "system", "content": "First"},
            {"role": "system", "content": "Second"},
        ]
        system_text, remaining = _extract_system(messages)
        assert system_text == "Second"
        assert len(remaining) == 0


class TestSafeRepr:
    def test_normal_string(self):
        assert _safe_repr("hello") == "'hello'"

    def test_long_string_truncated(self):
        long_str = "x" * 3000
        result = _safe_repr(long_str)
        assert len(result) < 2500
        assert "truncated" in result


# ---------------------------------------------------------------------------
# AIService tests with mocked clients
# ---------------------------------------------------------------------------

TEST_API_KEY = "sk-test-key"
TEST_MODEL = "test-model"


@pytest.fixture
def openai_service():
    """Return an AIService configured for OpenAI-compatible provider."""
    return AIService(
        api_endpoint="https://api.openai.com",
        api_key=TEST_API_KEY,
        model=TEST_MODEL,
        temperature=0.7,
        thinking_mode="off",
    )


@pytest.fixture
def anthropic_service():
    """Return an AIService configured for Anthropic."""
    return AIService(
        api_endpoint="https://api.anthropic.com",
        api_key=TEST_API_KEY,
        model="claude-sonnet-4-20250514",
        temperature=0.7,
        thinking_mode="off",
    )


class TestAIServiceInit:
    def test_openai_provider_detection(self):
        service = AIService(
            api_endpoint="https://api.openai.com",
            api_key=TEST_API_KEY,
            model=TEST_MODEL,
        )
        assert service._use_anthropic is False
        assert hasattr(service, "_openai_client")

    def test_anthropic_provider_detection(self):
        service = AIService(
            api_endpoint="https://api.anthropic.com",
            api_key=TEST_API_KEY,
            model="claude-sonnet-4-20250514",
        )
        assert service._use_anthropic is True
        assert hasattr(service, "_anthropic_client")

    def test_explicit_use_anthropic_overrides(self):
        service = AIService(
            api_endpoint="https://api.openai.com",
            api_key=TEST_API_KEY,
            model=TEST_MODEL,
            use_anthropic=True,
        )
        assert service._use_anthropic is True

    def test_explicit_use_openai_overrides(self):
        service = AIService(
            api_endpoint="https://api.anthropic.com",
            api_key=TEST_API_KEY,
            model="claude-sonnet-4-20250514",
            use_anthropic=False,
        )
        assert service._use_anthropic is False


class TestThinkingParams:
    def test_thinking_off_returns_temperature_only(self):
        service = AIService(
            api_endpoint="https://api.anthropic.com",
            api_key=TEST_API_KEY,
            model=TEST_MODEL,
            thinking_mode="off",
        )
        params = service._thinking_params()
        assert params == {"temperature": 0.7}
        assert "thinking" not in params

    def test_thinking_on_adds_thinking_block(self):
        service = AIService(
            api_endpoint="https://api.anthropic.com",
            api_key=TEST_API_KEY,
            model=TEST_MODEL,
            thinking_mode="on",
            thinking_budget_tokens=4000,
        )
        params = service._thinking_params()
        assert "thinking" in params
        assert params["thinking"]["type"] == "enabled"
        assert params["thinking"]["budget_tokens"] == 4000

    def test_thinking_auto_adds_thinking_block(self):
        service = AIService(
            api_endpoint="https://api.anthropic.com",
            api_key=TEST_API_KEY,
            model=TEST_MODEL,
            thinking_mode="auto",
        )
        params = service._thinking_params()
        assert "thinking" in params
        assert params["thinking"]["type"] == "enabled"


class TestBuildAgenticContext:
    def test_no_context_yields_empty_tools(self):
        service = AIService(
            api_endpoint="https://api.openai.com",
            api_key=TEST_API_KEY,
            model=TEST_MODEL,
        )
        tools, system_text = service._build_agentic_context(
            project=None,
            trace_summary=None,
        )
        assert tools == []
        assert system_text == ""

    def test_trace_context_adds_trace_tools(self):
        service = AIService(
            api_endpoint="https://api.openai.com",
            api_key=TEST_API_KEY,
            model=TEST_MODEL,
        )
        trace_summary = {
            "format": "json_trace",
            "duration_ms": 5000,
            "processes": [{"name": "app", "pid": 1}],
            "total_events": 100,
            "metadata": {},
        }
        tools, system_text = service._build_agentic_context(
            project=None,
            trace_summary=trace_summary,
        )
        assert len(tools) > 0
        assert any(t["name"] == "query_trace_overview" for t in tools)
        assert "Perfetto trace" in system_text

    # REMOVED: entries→file refactor — test_log_entries_context_adds_log_tools removed.
    # In-memory log_entries parameter no longer exists; source_path is the only data path.
    # See test_file_path_context_adds_lazy_tools below for the replacement.

    def test_file_path_context_adds_lazy_tools(self):
        with tempfile.NamedTemporaryFile(mode="w", suffix=".log", delete=False) as f:
            f.write("test content")
            path = f.name
        try:
            service = AIService(
                api_endpoint="https://api.openai.com",
                api_key=TEST_API_KEY,
                model=TEST_MODEL,
            )
            tools, system_text = service._build_agentic_context(
                project=None, trace_summary=None, source_path=path
            )
            assert len(tools) > 0
            assert any(t["name"] == "overview_local_log" for t in tools)
            assert "local data file" in system_text.lower()
        finally:
            import os

            os.unlink(path)

    def test_language_setting_in_context(self):
        service = AIService(
            api_endpoint="https://api.openai.com",
            api_key=TEST_API_KEY,
            model=TEST_MODEL,
        )
        tools, system_text = service._build_agentic_context(
            project=None, trace_summary=None, language="zh"
        )
        assert "Chinese" in system_text or "中文" in system_text


# ---------------------------------------------------------------------------
# Streaming tests (mock the underlying SDK calls)
# ---------------------------------------------------------------------------


class TestStreamChatOpenai:
    @pytest.mark.asyncio
    async def test_stream_chat_openai_yields_text(self, openai_service):
        """Mock the OpenAI stream to return a simple text chunk."""

        fake_chunk = MagicMock()
        fake_chunk.choices = [MagicMock()]
        fake_chunk.choices[0].delta.content = "Hello world"

        fake_stream = AsyncMock()
        fake_stream.__aiter__.return_value = [fake_chunk]

        mock_create = AsyncMock(return_value=fake_stream)

        with patch.object(openai_service._openai_client.chat.completions, "create", mock_create):
            chunks = []
            async for chunk in openai_service._stream_chat_openai(
                [{"role": "user", "content": "Hi"}]
            ):
                chunks.append(chunk)

        assert chunks == ["Hello world"]
        mock_create.assert_called_once()

    @pytest.mark.asyncio
    async def test_stream_chat_openai_empty_response(self, openai_service):
        """Mock stream with no content."""
        fake_chunk = MagicMock()
        fake_chunk.choices = [MagicMock()]
        fake_chunk.choices[0].delta.content = None

        fake_stream = AsyncMock()
        fake_stream.__aiter__.return_value = [fake_chunk]

        mock_create = AsyncMock(return_value=fake_stream)

        with patch.object(openai_service._openai_client.chat.completions, "create", mock_create):
            chunks = []
            async for chunk in openai_service._stream_chat_openai(
                [{"role": "user", "content": "Hi"}]
            ):
                chunks.append(chunk)

        assert chunks == []


class TestStreamChatAnthropic:
    @pytest.mark.asyncio
    async def test_stream_chat_anthropic_yields_text(self, anthropic_service):
        """Mock the Anthropic stream to return a text delta."""

        # Build a mock stream that yields text deltas
        fake_text_delta = MagicMock()
        fake_text_delta.type = "content_block_delta"
        fake_text_delta.delta = MagicMock()
        fake_text_delta.delta.type = "text_delta"
        fake_text_delta.delta.text = "Hello from Claude"

        fake_stream = MagicMock()
        fake_stream.__aenter__ = AsyncMock(return_value=fake_stream)
        fake_stream.__aexit__ = AsyncMock(return_value=None)
        fake_stream.__aiter__.return_value = [fake_text_delta]

        # Override the internal _anthropic_client to be a mock
        mock_client = MagicMock()
        mock_messages = MagicMock()
        mock_messages.stream = MagicMock(return_value=fake_stream)
        mock_client.messages = mock_messages

        anthropic_service._anthropic_client = mock_client

        chunks = []
        async for chunk in anthropic_service._stream_chat_anthropic(
            [{"role": "user", "content": "Hi"}]
        ):
            chunks.append(chunk)

        assert "Hello from Claude" in chunks
