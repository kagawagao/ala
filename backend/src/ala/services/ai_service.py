"""Anthropic-compatible AI service with async streaming and agentic tool calling."""
import json
from collections.abc import AsyncIterator
from typing import Any

import anthropic

from .agent_tools import AGENT_TOOLS, execute_tool
from .code_scanner import CodeScanner
from .project_manager import Project

MAX_TOOL_ROUNDS = 10
MAX_TOKENS = 8192
_scanner = CodeScanner()


class AIService:
    def __init__(
        self, api_endpoint: str, api_key: str, model: str, temperature: float = 0.7
    ):
        self._client = anthropic.AsyncAnthropic(api_key=api_key, base_url=api_endpoint)
        self._model = model
        self._temperature = temperature

    async def stream_chat(self, messages: list[dict]) -> AsyncIterator[str]:
        """Simple streaming chat without tool calling."""
        system_text, api_messages = self._extract_system(messages)

        async with self._client.messages.stream(
            model=self._model,
            max_tokens=MAX_TOKENS,
            system=system_text or anthropic.NOT_GIVEN,
            messages=api_messages,
            temperature=self._temperature,
        ) as stream:
            async for text in stream.text_stream:
                yield text

    async def stream_chat_agentic(
        self,
        messages: list[dict],
        project: Project,
    ) -> AsyncIterator[str]:
        """Run an agentic chat loop with tool calling.

        Yields SSE-formatted events:
        - Regular text: raw content string
        - Tool calls: JSON with type="tool_call"
        - Tool results: JSON with type="tool_result"
        """
        # Discover and load project context docs (AGENTS.md, copilot-instructions.md, etc.)
        context_docs = _scanner.discover_context_docs(project.paths)

        # Build system instruction with project context
        parts = [
            f"You are an Android log and code analyzer agent. "
            f"You have access to the source code of the project '{project.name}' "
            f"located at: {', '.join(project.paths)}. "
            f"Use the available tools to explore the project's source code when it would "
            f"help you analyze logs, traces, crashes, or answer questions about the codebase. "
            f"Always cite specific files and line numbers when referencing code.",
        ]

        # Inject discovered context docs as project instructions
        if context_docs:
            parts.append("\n--- Project Context Documents ---")
            for doc in context_docs:
                parts.append(f"\n### {doc.path}\n\n{doc.content}")
            parts.append("\n--- End Project Context ---")

        system_text = "\n".join(parts)

        # Extract any existing system message and merge
        existing_system, api_messages = self._extract_system(messages)
        if existing_system:
            system_text = system_text + "\n\n" + existing_system

        for _round in range(MAX_TOOL_ROUNDS):
            # Stream the response
            content_parts: list[str] = []
            tool_uses: list[dict[str, Any]] = []
            current_tool: dict[str, Any] | None = None
            current_input_json = ""

            async with self._client.messages.stream(
                model=self._model,
                max_tokens=MAX_TOKENS,
                system=system_text,
                messages=api_messages,
                temperature=self._temperature,
                tools=AGENT_TOOLS,
            ) as stream:
                async for event in stream:
                    if event.type == "content_block_start":
                        if event.content_block.type == "text":
                            pass  # text will come via deltas
                        elif event.content_block.type == "tool_use":
                            current_tool = {
                                "id": event.content_block.id,
                                "name": event.content_block.name,
                            }
                            current_input_json = ""
                    elif event.type == "content_block_delta":
                        if event.delta.type == "text_delta":
                            content_parts.append(event.delta.text)
                            yield event.delta.text
                        elif event.delta.type == "input_json_delta":
                            current_input_json += event.delta.partial_json
                    elif event.type == "content_block_stop":
                        if current_tool:
                            try:
                                parsed_input = json.loads(current_input_json) if current_input_json else {}
                            except json.JSONDecodeError:
                                parsed_input = {}
                            current_tool["input"] = parsed_input
                            tool_uses.append(current_tool)
                            current_tool = None
                            current_input_json = ""

            if not tool_uses:
                # No tool calls — we're done
                break

            # Build the assistant message with content blocks
            assistant_content: list[dict[str, Any]] = []
            text_so_far = "".join(content_parts)
            if text_so_far:
                assistant_content.append({"type": "text", "text": text_so_far})
            for tu in tool_uses:
                assistant_content.append({
                    "type": "tool_use",
                    "id": tu["id"],
                    "name": tu["name"],
                    "input": tu["input"],
                })
            api_messages.append({"role": "assistant", "content": assistant_content})

            # Execute each tool and build tool_result blocks
            tool_result_blocks: list[dict[str, Any]] = []
            for tu in tool_uses:
                arguments_str = json.dumps(tu["input"])

                # Emit tool_call event
                yield json.dumps({
                    "type": "tool_call",
                    "name": tu["name"],
                    "arguments": arguments_str,
                })

                result = execute_tool(project, tu["name"], arguments_str)

                # Emit tool_result event
                yield json.dumps({
                    "type": "tool_result",
                    "name": tu["name"],
                    "content": result[:2000],
                })

                tool_result_blocks.append({
                    "type": "tool_result",
                    "tool_use_id": tu["id"],
                    "content": result,
                })

            api_messages.append({"role": "user", "content": tool_result_blocks})
            content_parts = []

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

