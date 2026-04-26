"""Multi-provider AI service with async streaming and agentic tool calling.

Supports:
- Anthropic (api.anthropic.com) — native SDK with extended thinking + tool calling
- OpenAI-compatible endpoints — openai SDK (OpenAI, Groq, Together AI, Ollama, etc.)

Provider is detected automatically from the configured API endpoint.
"""

import asyncio
import json
import logging
from collections.abc import AsyncIterator
from typing import Any
from urllib.parse import urlparse

import anthropic
import openai

from .agent_tools import AGENT_TOOLS, LOG_TOOLS, TRACE_TOOLS, LogIndex, execute_tool
from .code_scanner import CodeScanner
from .project_manager import Project

MAX_TOOL_ROUNDS = 10
MAX_TOKENS = 32768
_scanner = CodeScanner()
logger = logging.getLogger(__name__)


def _is_anthropic_endpoint(endpoint: str) -> bool:
    """Return True when the endpoint's hostname belongs to Anthropic's API.

    Uses proper URL parsing to prevent substring-match bypasses such as
    ``https://evil.com?q=anthropic.com``.  Only HTTPS endpoints are accepted
    to prevent API key interception over plain HTTP.
    """
    try:
        parsed = urlparse(endpoint)
        hostname = parsed.hostname or ""
    except ValueError:
        return False
    if parsed.scheme != "https":
        if parsed.scheme:
            logger.warning(
                "Non-HTTPS endpoint %r rejected for Anthropic detection — use HTTPS to avoid"
                " API key interception",
                endpoint,
            )
        return False
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


def _truncate_tool_result(tool_name: str, result_str: str, max_chars: int = 8000) -> str:
    """Truncate tool results intelligently based on tool type."""
    if len(result_str) <= max_chars:
        return result_str

    try:
        data = json.loads(result_str)
    except json.JSONDecodeError:
        return result_str[:max_chars] + "… (truncated)"

    if tool_name == "search_logs":
        entries = data.get("entries", [])
        total = data.get("total_matched", len(entries))
        if len(entries) > 50:
            data["entries"] = entries[:30] + entries[-20:]
            data["_note"] = f"Showing first 30 + last 20 of {total} matches. Use offset to paginate."
    elif tool_name in ("list_project_files", "list_log_files"):
        files = data.get("files", [])
        if len(files) > 100:
            data["files"] = files[:100]
            data["_note"] = f"Showing first 100 of {len(files)} files."
    elif tool_name == "search_project_code":
        matches = data.get("matches", [])
        total_matches = data.get("total_matches", len(matches))
        if len(matches) > 20:
            data["matches"] = matches[:20]
            data["_note"] = f"Showing first 20 of {total_matches} matches."

    result_str = json.dumps(data)
    if len(result_str) > max_chars:
        result_str = result_str[:max_chars] + "… (truncated)"
    return result_str


class AIService:
    def __init__(
        self,
        api_endpoint: str,
        api_key: str,
        model: str,
        temperature: float = 0.7,
        thinking_mode: str = "off",
        thinking_budget_tokens: int = 8000,
        use_anthropic: bool | None = None,
    ):
        self._model = model
        self._temperature = temperature
        self._thinking_mode = thinking_mode
        self._thinking_budget = thinking_budget_tokens
        # Explicit flag takes precedence over endpoint-based auto-detection
        self._use_anthropic = (
            use_anthropic if use_anthropic is not None else _is_anthropic_endpoint(api_endpoint)
        )

        if self._use_anthropic:
            self._anthropic_client = anthropic.AsyncAnthropic(
                api_key=api_key, base_url=api_endpoint
            )
        else:
            try:
                parsed = urlparse(api_endpoint)
                if parsed.scheme and parsed.scheme != "https":
                    logger.warning(
                        "Non-HTTPS endpoint %r configured for OpenAI-compatible provider"
                        " — API key may be transmitted in plain text",
                        api_endpoint,
                    )
            except ValueError:
                pass
            self._openai_client = openai.AsyncOpenAI(api_key=api_key, base_url=api_endpoint)

        provider = "anthropic" if self._use_anthropic else "openai-compat"
        logger.debug(
            "AIService initialised — provider=%s endpoint=%s model=%s temperature=%s thinking=%s",
            provider,
            api_endpoint,
            model,
            temperature,
            thinking_mode,
        )

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
        log_index: LogIndex | None = None,
        api_messages_out: list | None = None,
        resume_messages: list[dict] | None = None,
        resume_provider: str | None = None,
    ) -> AsyncIterator[str]:
        """Agentic chat loop with tool calling.

        Parameters
        ----------
        api_messages_out:
            Optional mutable list.  When provided, the final raw API message list
            (including all tool-call and tool-result blocks) is appended to it
            after the loop completes.  Callers can persist this for later resumption.
        resume_messages:
            Raw API messages from a previous agentic exchange.  When provided (and
            the provider matches), they replace the rebuilt message history so the
            model has full tool-call context for continuation requests.
        resume_provider:
            The provider tag ("anthropic" / "openai") used when ``resume_messages``
            were captured.  Only used when resume_messages is not None.
        """
        current_provider = "anthropic" if self._use_anthropic else "openai"
        # Only resume if the provider hasn't changed between requests.
        can_resume = (
            resume_messages is not None
            and resume_provider == current_provider
        )
        if self._use_anthropic:
            async for chunk in self._stream_chat_agentic_anthropic(
                messages,
                project=project,
                trace_summary=trace_summary,
                log_entries=log_entries,
                log_index=log_index,
                api_messages_out=api_messages_out,
                resume_messages=resume_messages if can_resume else None,
            ):
                yield chunk
        else:
            async for chunk in self._stream_chat_agentic_openai(
                messages,
                project=project,
                trace_summary=trace_summary,
                log_entries=log_entries,
                log_index=log_index,
                api_messages_out=api_messages_out,
                resume_messages=resume_messages if can_resume else None,
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
                f"When analyzing logs or crashes, systematically explore the codebase: "
                f"start with list_project_files to understand the project structure, "
                f"then read relevant source files and search for specific symbols, "
                f"class names, or error strings found in the logs. "
                f"Always correlate log tags, PIDs, and error messages with specific "
                f"source files and line numbers. "
                f"Complete your full analysis before responding — never stop mid-analysis. "
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
                "Always start with query_log_overview to understand the full log scope "
                "(level distribution, time range, unique tags and PIDs). "
                "Then use search_logs with targeted filters (level, tag, keyword, time range) "
                "to retrieve relevant entries. "
                "For large result sets, use the 'offset' parameter to paginate and ensure "
                "you have seen all matching entries before drawing conclusions. "
                "Perform multiple targeted searches to ensure comprehensive coverage. "
                "Do not guess log details — always query them with tools. "
                "Complete the full analysis before responding; never stop mid-analysis. "
                "If asked to continue or resume, check the conversation history to see "
                "what has already been analyzed and only search for what hasn't been covered yet."
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

        logger.debug("Anthropic stream_chat — model=%s messages=%d", self._model, len(api_messages))

        in_thinking = False
        current_thinking = ""

        try:
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
        except anthropic.APIStatusError as exc:
            logger.error(
                "Anthropic API error in stream_chat — status=%s message=%s",
                exc.status_code,
                exc.message,
                exc_info=True,
            )
            raise
        except anthropic.APIConnectionError as exc:
            logger.error("Anthropic connection error in stream_chat: %s", exc, exc_info=True)
            raise
        except Exception as exc:
            logger.exception("Unexpected error in Anthropic stream_chat: %s", exc)
            raise

    async def _stream_chat_agentic_anthropic(
        self,
        messages: list[dict],
        project: Project | None = None,
        trace_summary: dict | None = None,
        log_entries: list[dict] | None = None,
        log_index: LogIndex | None = None,
        api_messages_out: list | None = None,
        resume_messages: list[dict] | None = None,
    ) -> AsyncIterator[str]:
        """Agentic chat loop with Anthropic tool calling. Supports extended thinking.

        Yields SSE-formatted events:
        - Regular text: raw content string
        - Thinking: JSON with type="thinking"
        - Tool calls: JSON with type="tool_call"
        - Tool results: JSON with type="tool_result"
        """
        tools, system_text = self._build_agentic_context(project, trace_summary, log_entries)

        existing_system, rebuilt_messages = self._extract_system(messages)
        if existing_system:
            system_text = system_text + "\n\n" + existing_system

        # If resuming from a previous exchange, start from the stored full API
        # message history (which includes tool-call blocks) and append only the
        # latest user message so the model has complete context.
        if resume_messages:
            api_messages: list[dict[str, Any]] = list(resume_messages)
            # Append the new user message (last element of rebuilt_messages).
            if rebuilt_messages and rebuilt_messages[-1].get("role") == "user":
                api_messages.append(rebuilt_messages[-1])
            logger.debug(
                "Anthropic agentic_chat (resume) — model=%s resumed_msgs=%d tools=%d",
                self._model,
                len(api_messages),
                len(tools),
            )
        else:
            api_messages = rebuilt_messages
            logger.debug(
                "Anthropic agentic_chat — model=%s messages=%d tools=%d",
                self._model,
                len(api_messages),
                len(tools),
            )

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

            try:
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
            except anthropic.APIStatusError as exc:
                logger.error(
                    "Anthropic API error in agentic_chat (round %d) — status=%s message=%s",
                    _round,
                    exc.status_code,
                    exc.message,
                    exc_info=True,
                )
                raise
            except anthropic.APIConnectionError as exc:
                logger.error(
                    "Anthropic connection error in agentic_chat (round %d): %s",
                    _round,
                    exc,
                    exc_info=True,
                )
                raise
            except Exception as exc:
                logger.exception(
                    "Unexpected error in Anthropic agentic_chat (round %d): %s", _round, exc
                )
                raise

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

            # Yield tool_call events immediately in original order
            for tu in tool_uses:
                arguments_str = json.dumps(tu["input"])
                logger.debug("Tool call — name=%s arguments=%s", tu["name"], arguments_str[:200])
                yield json.dumps(
                    {"type": "tool_call", "name": tu["name"], "arguments": arguments_str}
                )

            # Execute all tools concurrently
            async def _run_one(tu: dict[str, Any]) -> tuple[dict[str, Any], str]:
                arguments_str = json.dumps(tu["input"])
                result = await asyncio.to_thread(
                    execute_tool,
                    project,
                    tu["name"],
                    arguments_str,
                    trace_summary=trace_summary,
                    log_entries=log_entries,
                    log_index=log_index,
                )
                return tu, result

            tasks = [_run_one(tu) for tu in tool_uses]
            results = await asyncio.gather(*tasks)

            # Yield tool_result events in original order
            tool_result_blocks: list[dict[str, Any]] = []
            for tu, result in results:
                logger.debug("Tool result — name=%s length=%d", tu["name"], len(result))
                yield json.dumps(
                    {"type": "tool_result", "name": tu["name"], "content": result[:2000]}
                )
                tool_result_blocks.append(
                    {
                        "type": "tool_result",
                        "tool_use_id": tu["id"],
                        "content": _truncate_tool_result(tu["name"], result),
                    }
                )

            api_messages.append({"role": "user", "content": tool_result_blocks})

        # Expose the final API messages (with full tool-call history) to the caller
        # so they can be persisted in the session for continuation requests.
        if api_messages_out is not None:
            api_messages_out.extend(api_messages)

    # ── OpenAI-compatible implementation ─────────────────────────────────────

    async def _stream_chat_openai(self, messages: list[dict]) -> AsyncIterator[str]:
        """Simple streaming chat via OpenAI-compatible API."""
        logger.debug("OpenAI stream_chat — model=%s messages=%d", self._model, len(messages))
        try:
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
        except openai.APIStatusError as exc:
            logger.error(
                "OpenAI API error in stream_chat — status=%s message=%s",
                exc.status_code,
                exc.message,
                exc_info=True,
            )
            raise
        except openai.APIConnectionError as exc:
            logger.error("OpenAI connection error in stream_chat: %s", exc, exc_info=True)
            raise
        except Exception as exc:
            logger.exception("Unexpected error in OpenAI stream_chat: %s", exc)
            raise

    async def _stream_chat_agentic_openai(
        self,
        messages: list[dict],
        project: Project | None = None,
        trace_summary: dict | None = None,
        log_entries: list[dict] | None = None,
        log_index: LogIndex | None = None,
        api_messages_out: list | None = None,
        resume_messages: list[dict] | None = None,
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

        if resume_messages:
            # Restore full conversation history (including tool-call blocks) and
            # append only the latest user message.
            openai_messages: list[dict[str, Any]] = list(resume_messages)
            if base_messages and base_messages[-1].get("role") == "user":
                openai_messages.append(base_messages[-1])
            logger.debug(
                "OpenAI agentic_chat (resume) — model=%s resumed_msgs=%d tools=%d",
                self._model,
                len(openai_messages),
                len(openai_tools),
            )
        else:
            openai_messages = []
            if combined_system:
                openai_messages.append({"role": "system", "content": combined_system})
            openai_messages.extend(base_messages)
            logger.debug(
                "OpenAI agentic_chat — model=%s messages=%d tools=%d",
                self._model,
                len(openai_messages),
                len(openai_tools),
            )

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

            try:
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
            except openai.APIStatusError as exc:
                logger.error(
                    "OpenAI API error in agentic_chat (round %d) — status=%s message=%s",
                    _round,
                    exc.status_code,
                    exc.message,
                    exc_info=True,
                )
                raise
            except openai.APIConnectionError as exc:
                logger.error(
                    "OpenAI connection error in agentic_chat (round %d): %s",
                    _round,
                    exc,
                    exc_info=True,
                )
                raise
            except Exception as exc:
                logger.exception(
                    "Unexpected error in OpenAI agentic_chat (round %d): %s", _round, exc
                )
                raise

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

                logger.debug("Tool call — name=%s arguments=%s", tc["name"], arguments_str[:200])

                yield json.dumps({"type": "tool_call", "name": tc["name"], "arguments": arguments_str})

                result = execute_tool(
                    project,
                    tc["name"],
                    arguments_str,
                    trace_summary=trace_summary,
                    log_entries=log_entries,
                    log_index=log_index,
                )

                logger.debug("Tool result — name=%s length=%d", tc["name"], len(result))

                yield json.dumps(
                    {"type": "tool_result", "name": tc["name"], "content": result[:2000]}
                )

                openai_messages.append(
                    {
                        "role": "tool",
                        "tool_call_id": tc["id"],
                        "content": _truncate_tool_result(tc["name"], result),
                    }
                )

        # Expose the final API messages (with full tool-call history) to the caller.
        if api_messages_out is not None:
            api_messages_out.extend(openai_messages)
