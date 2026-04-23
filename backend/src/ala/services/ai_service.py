"""Multi-provider AI service with async streaming and agentic tool calling.

Supports:
- Anthropic (api.anthropic.com) — native SDK with extended thinking + tool calling
- OpenAI-compatible endpoints — openai SDK (OpenAI, Groq, Together AI, Ollama, etc.)

Provider is detected automatically from the configured API endpoint.
"""

import json
from collections.abc import AsyncIterator
from typing import Any
from urllib.parse import urlparse

import anthropic
import openai

from .agent_tools import AGENT_TOOLS, LOG_TOOLS, TRACE_TOOLS, execute_tool
from .code_scanner import CodeScanner
from .project_manager import Project

MAX_TOOL_ROUNDS = 10
MAX_TOKENS = 8192
_scanner = CodeScanner()


def _is_anthropic_endpoint(endpoint: str) -> bool:
    """Return True when the endpoint's hostname belongs to Anthropic's API.

    Uses proper URL parsing to prevent substring-match bypasses such as
    ``https://evil.com?q=anthropic.com``.
    """
    try:
        hostname = urlparse(endpoint).hostname or ""
    except Exception:
        hostname = ""
    return hostname == "api.anthropic.com" or hostname.endswith(".anthropic.com")


def _anthropic_tool_to_openai(tool: dict) -> dict:
    """Convert an Anthropic tool schema to OpenAI function-calling format."""
    return {
        "type": "function",
        "function": {
            "name": tool["name"],
            "description": tool.get("description", ""),
            "parameters": tool.get("input_schema", {"type": "object", "properties": {}}),
        },
    }


class AIService:
    def __init__(
        self,
        api_endpoint: str,
        api_key: str,
        model: str,
        temperature: float = 0.7,
        thinking_mode: str = "off",
        thinking_budget_tokens: int = 8000,
    ):
        self._model = model
        self._temperature = temperature
        self._thinking_mode = thinking_mode
        self._thinking_budget = thinking_budget_tokens
        self._use_anthropic = _is_anthropic_endpoint(api_endpoint)

        if self._use_anthropic:
            self._anthropic_client = anthropic.AsyncAnthropic(
                api_key=api_key, base_url=api_endpoint
            )
        else:
            self._openai_client = openai.AsyncOpenAI(api_key=api_key, base_url=api_endpoint)

    # ── Public interface ──────────────────────────────────────────────────────

    async def stream_chat(self, messages: list[dict]) -> AsyncIterator[str]:
        """Simple streaming chat (no tool calling)."""
        if self._use_anthropic:
            async for chunk in self._stream_chat_anthropic(messages):
                yield chunk
        else:
            async for chunk in self._stream_chat_openai(messages):
                yield chunk

    async def stream_chat_agentic(
        self,
        messages: list[dict],
        project: Project | None = None,
        trace_summary: dict | None = None,
        log_entries: list[dict] | None = None,
    ) -> AsyncIterator[str]:
        """Agentic chat loop with tool calling."""
        if self._use_anthropic:
            async for chunk in self._stream_chat_agentic_anthropic(
                messages, project=project, trace_summary=trace_summary, log_entries=log_entries
            ):
                yield chunk
        else:
            async for chunk in self._stream_chat_agentic_openai(
                messages, project=project, trace_summary=trace_summary, log_entries=log_entries
            ):
                yield chunk

    # ── Shared helpers ────────────────────────────────────────────────────────

    def _thinking_params(self) -> dict[str, Any]:
        """Return extra kwargs for the Anthropic API when thinking is enabled."""
        if self._thinking_mode in ("on", "auto"):
            return {
                "thinking": {"type": "enabled", "budget_tokens": self._thinking_budget},
                "temperature": 1,  # required by Anthropic for extended thinking
                "extra_headers": {"anthropic-beta": "interleaved-thinking-2025-05-14"},
            }
        return {"temperature": self._temperature}

    def _build_agentic_context(
        self,
        project: Project | None,
        trace_summary: dict | None,
        log_entries: list[dict] | None,
    ) -> tuple[list[dict[str, Any]], str]:
        """Build tool list and system prompt text for agentic mode.

        Returns (tools, system_text).
        """
        tools: list[dict[str, Any]] = []
        parts: list[str] = []

        if project:
            tools.extend(AGENT_TOOLS)
            context_docs = _scanner.discover_context_docs(project.paths)
            parts.append(
                f"You are an Android log and code analyzer agent. "
                f"You have access to the source code of the project '{project.name}' "
                f"located at: {', '.join(project.paths)}. "
                f"Use the available tools to explore the project's source code when it would "
                f"help you analyze logs, traces, crashes, or answer questions about the codebase. "
                f"Always cite specific files and line numbers when referencing code."
            )
            if context_docs:
                parts.append("\n--- Project Context Documents ---")
                for doc in context_docs:
                    parts.append(f"\n### {doc.path}\n\n{doc.content}")
                parts.append("\n--- End Project Context ---")

        if log_entries is not None:
            tools.extend(LOG_TOOLS)
            n_entries = len(log_entries)
            log_hint = (
                f"{n_entries} Android log entries are loaded in this session. "
                "Use query_log_overview to get statistics and search_logs to find relevant entries. "
                "Do not guess log details — query them with tools."
            )
            if project:
                parts.append(log_hint)
            else:
                parts.insert(0, "You are an Android log analyzer agent. " + log_hint)

        if trace_summary:
            tools.extend(TRACE_TOOLS)
            meta = trace_summary.get("metadata", {})
            fmt = trace_summary.get("format", "unknown")
            dur = trace_summary.get("duration_ms")
            n_proc = len(trace_summary.get("processes", []))
            n_ev = trace_summary.get("total_events", "?")
            trace_hint = (
                f"A Perfetto trace is loaded in this session "
                f"(format={fmt}, duration={dur}ms, {n_proc} processes, {n_ev} events"
            )
            if meta:
                trace_hint += f", metadata={json.dumps(meta)}"
            trace_hint += "). Use trace tools to explore performance data on demand."
            parts.append(trace_hint)

        return tools, "\n".join(parts)

    @staticmethod
    def _extract_system(messages: list[dict]) -> tuple[str | None, list[dict]]:
        """Extract system message from message list.

        Anthropic uses system as a separate parameter, not in messages.
        Returns (system_text, remaining_messages).
        """
        system_text = None
        api_messages = []
        for msg in messages:
            if msg.get("role") == "system":
                system_text = msg.get("content", "")
            else:
                api_messages.append(msg)
        return system_text, api_messages

    # ── Anthropic implementation ──────────────────────────────────────────────

    async def _stream_chat_anthropic(self, messages: list[dict]) -> AsyncIterator[str]:
        """Simple streaming chat via Anthropic. Supports extended thinking."""
        system_text, api_messages = self._extract_system(messages)

        extra = self._thinking_params()
        extra_headers = extra.pop("extra_headers", None)

        stream_kwargs: dict[str, Any] = {
            "model": self._model,
            "max_tokens": MAX_TOKENS,
            "system": system_text or anthropic.NOT_GIVEN,
            "messages": api_messages,
            **extra,
        }
        if extra_headers:
            stream_kwargs["extra_headers"] = extra_headers

        in_thinking = False
        current_thinking = ""

        async with self._anthropic_client.messages.stream(**stream_kwargs) as stream:
            async for event in stream:
                if event.type == "content_block_start":
                    if event.content_block.type == "thinking":
                        in_thinking = True
                        current_thinking = ""
                    else:
                        in_thinking = False
                elif event.type == "content_block_delta":
                    if event.delta.type == "thinking_delta":
                        current_thinking += event.delta.thinking
                    elif event.delta.type == "text_delta":
                        yield event.delta.text
                elif event.type == "content_block_stop":
                    if in_thinking:
                        yield json.dumps({"type": "thinking", "content": current_thinking})
                        in_thinking = False
                        current_thinking = ""

    async def _stream_chat_agentic_anthropic(
        self,
        messages: list[dict],
        project: Project | None = None,
        trace_summary: dict | None = None,
        log_entries: list[dict] | None = None,
    ) -> AsyncIterator[str]:
        """Agentic chat loop with Anthropic tool calling. Supports extended thinking.

        Yields SSE-formatted events:
        - Regular text: raw content string
        - Thinking: JSON with type="thinking"
        - Tool calls: JSON with type="tool_call"
        - Tool results: JSON with type="tool_result"
        """
        tools, system_text = self._build_agentic_context(project, trace_summary, log_entries)

        existing_system, api_messages = self._extract_system(messages)
        if existing_system:
            system_text = system_text + "\n\n" + existing_system

        extra = self._thinking_params()
        extra_headers = extra.pop("extra_headers", None)

        for _round in range(MAX_TOOL_ROUNDS):
            tool_uses: list[dict[str, Any]] = []
            current_tool: dict[str, Any] | None = None
            current_input_json = ""
            in_thinking_block = False
            current_thinking = ""

            stream_kwargs: dict[str, Any] = {
                "model": self._model,
                "max_tokens": MAX_TOKENS,
                "system": system_text,
                "messages": api_messages,
                "tools": tools,
                **extra,
            }
            if extra_headers:
                stream_kwargs["extra_headers"] = extra_headers

            async with self._anthropic_client.messages.stream(**stream_kwargs) as stream:
                async for event in stream:
                    if event.type == "content_block_start":
                        cb = event.content_block
                        if cb.type == "thinking":
                            in_thinking_block = True
                            current_thinking = ""
                        elif cb.type == "tool_use":
                            in_thinking_block = False
                            current_tool = {"id": cb.id, "name": cb.name}
                            current_input_json = ""
                        else:
                            in_thinking_block = False
                    elif event.type == "content_block_delta":
                        if event.delta.type == "thinking_delta":
                            current_thinking += event.delta.thinking
                        elif event.delta.type == "text_delta":
                            yield event.delta.text
                        elif event.delta.type == "input_json_delta":
                            current_input_json += event.delta.partial_json
                    elif event.type == "content_block_stop":
                        if in_thinking_block:
                            yield json.dumps({"type": "thinking", "content": current_thinking})
                            in_thinking_block = False
                            current_thinking = ""
                        elif current_tool is not None:
                            try:
                                parsed_input = (
                                    json.loads(current_input_json) if current_input_json else {}
                                )
                            except json.JSONDecodeError:
                                parsed_input = {}
                            current_tool["input"] = parsed_input
                            tool_uses.append(current_tool)
                            current_tool = None
                            current_input_json = ""

                # Use get_final_message() to obtain exact content blocks (preserves
                # thinking block signatures required for multi-turn correctness).
                final_msg = await stream.get_final_message()

            assistant_content: list[dict[str, Any]] = []
            for block in final_msg.content:
                if block.type == "thinking":
                    block_dict: dict[str, Any] = {"type": "thinking", "thinking": block.thinking}
                    if getattr(block, "signature", None):
                        block_dict["signature"] = block.signature
                    assistant_content.append(block_dict)
                elif block.type == "text":
                    assistant_content.append({"type": "text", "text": block.text})
                elif block.type == "tool_use":
                    assistant_content.append(
                        {
                            "type": "tool_use",
                            "id": block.id,
                            "name": block.name,
                            "input": block.input,
                        }
                    )

            api_messages.append({"role": "assistant", "content": assistant_content})

            if not tool_uses:
                break

            tool_result_blocks: list[dict[str, Any]] = []
            for tu in tool_uses:
                arguments_str = json.dumps(tu["input"])

                yield json.dumps(
                    {"type": "tool_call", "name": tu["name"], "arguments": arguments_str}
                )

                result = execute_tool(
                    project,
                    tu["name"],
                    arguments_str,
                    trace_summary=trace_summary,
                    log_entries=log_entries,
                )

                yield json.dumps(
                    {"type": "tool_result", "name": tu["name"], "content": result[:2000]}
                )

                tool_result_blocks.append(
                    {
                        "type": "tool_result",
                        "tool_use_id": tu["id"],
                        "content": result,
                    }
                )

            api_messages.append({"role": "user", "content": tool_result_blocks})

    # ── OpenAI-compatible implementation ─────────────────────────────────────

    async def _stream_chat_openai(self, messages: list[dict]) -> AsyncIterator[str]:
        """Simple streaming chat via OpenAI-compatible API."""
        stream = await self._openai_client.chat.completions.create(
            model=self._model,
            messages=messages,  # type: ignore[arg-type]
            temperature=self._temperature,
            max_tokens=MAX_TOKENS,
            stream=True,
        )
        async for chunk in stream:
            if chunk.choices and chunk.choices[0].delta.content:
                yield chunk.choices[0].delta.content

    async def _stream_chat_agentic_openai(
        self,
        messages: list[dict],
        project: Project | None = None,
        trace_summary: dict | None = None,
        log_entries: list[dict] | None = None,
    ) -> AsyncIterator[str]:
        """Agentic chat loop with OpenAI function-calling.

        Yields the same event types as the Anthropic agentic path so the frontend
        needs no changes:
        - Regular text: raw content string
        - Tool calls: JSON with type="tool_call"
        - Tool results: JSON with type="tool_result"
        """
        anthropic_tools, system_text = self._build_agentic_context(
            project, trace_summary, log_entries
        )
        openai_tools = [_anthropic_tool_to_openai(t) for t in anthropic_tools]

        # Build message list: prepend system prompt, then include any inline system message
        existing_system, base_messages = self._extract_system(messages)
        combined_system = system_text
        if existing_system:
            combined_system = combined_system + "\n\n" + existing_system

        openai_messages: list[dict[str, Any]] = []
        if combined_system:
            openai_messages.append({"role": "system", "content": combined_system})
        openai_messages.extend(base_messages)

        for _round in range(MAX_TOOL_ROUNDS):
            # Accumulate tool call deltas across streaming chunks
            tool_calls_acc: dict[int, dict[str, Any]] = {}
            text_content = ""

            stream_kwargs: dict[str, Any] = {
                "model": self._model,
                "messages": openai_messages,
                "temperature": self._temperature,
                "max_tokens": MAX_TOKENS,
                "stream": True,
            }
            if openai_tools:
                stream_kwargs["tools"] = openai_tools

            stream = await self._openai_client.chat.completions.create(
                **stream_kwargs  # type: ignore[arg-type]
            )
            async for chunk in stream:
                if not chunk.choices:
                    continue
                choice = chunk.choices[0]
                delta = choice.delta

                if delta.content:
                    text_content += delta.content
                    yield delta.content

                if delta.tool_calls:
                    for tc_delta in delta.tool_calls:
                        idx = tc_delta.index
                        if idx not in tool_calls_acc:
                            tool_calls_acc[idx] = {
                                "id": tc_delta.id or "",
                                "name": (tc_delta.function.name or "")
                                if tc_delta.function
                                else "",
                                "arguments": "",
                            }
                        if tc_delta.function and tc_delta.function.arguments:
                            tool_calls_acc[idx]["arguments"] += tc_delta.function.arguments

            tool_calls_list = list(tool_calls_acc.values())

            # Record the assistant turn in the conversation
            assistant_msg: dict[str, Any] = {"role": "assistant", "content": text_content or None}
            if tool_calls_list:
                assistant_msg["tool_calls"] = [
                    {
                        "id": tc["id"],
                        "type": "function",
                        "function": {"name": tc["name"], "arguments": tc["arguments"]},
                    }
                    for tc in tool_calls_list
                ]
            openai_messages.append(assistant_msg)

            if not tool_calls_list:
                break

            # Execute each tool and append results
            for tc in tool_calls_list:
                arguments_str = tc["arguments"]

                yield json.dumps({"type": "tool_call", "name": tc["name"], "arguments": arguments_str})

                result = execute_tool(
                    project,
                    tc["name"],
                    arguments_str,
                    trace_summary=trace_summary,
                    log_entries=log_entries,
                )

                yield json.dumps(
                    {"type": "tool_result", "name": tc["name"], "content": result[:2000]}
                )

                openai_messages.append(
                    {
                        "role": "tool",
                        "tool_call_id": tc["id"],
                        "content": result,
                    }
                )
