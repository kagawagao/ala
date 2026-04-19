"""OpenAI-compatible AI service with async streaming and agentic tool calling."""
import json
from collections.abc import AsyncIterator
from typing import Any

from openai import AsyncOpenAI

from .agent_tools import AGENT_TOOLS, execute_tool
from .project_manager import Project

MAX_TOOL_ROUNDS = 10


class AIService:
    def __init__(
        self, api_endpoint: str, api_key: str, model: str, temperature: float = 0.7
    ):
        self._client = AsyncOpenAI(api_key=api_key, base_url=api_endpoint)
        self._model = model
        self._temperature = temperature

    async def stream_chat(self, messages: list[dict]) -> AsyncIterator[str]:
        stream = await self._client.chat.completions.create(
            model=self._model,
            messages=messages,
            temperature=self._temperature,
            stream=True,
        )
        async for chunk in stream:
            if chunk.choices[0].delta.content:
                yield chunk.choices[0].delta.content

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
        - Done: "[DONE]"
        """
        working_messages = list(messages)

        # Add system instruction about available tools
        system_msg = (
            f"You are an Android log and code analyzer. "
            f"You have access to the source code of the project '{project.name}' "
            f"located at '{project.path}'. "
            f"Use the available tools to explore the project's source code when it would "
            f"help you analyze logs, traces, crashes, or answer questions about the codebase. "
            f"Always cite specific files and line numbers when referencing code."
        )
        # Prepend or merge with existing system message
        if working_messages and working_messages[0].get("role") == "system":
            working_messages[0]["content"] = system_msg + "\n\n" + working_messages[0]["content"]
        else:
            working_messages.insert(0, {"role": "system", "content": system_msg})

        for _round in range(MAX_TOOL_ROUNDS):
            response = await self._client.chat.completions.create(
                model=self._model,
                messages=working_messages,
                temperature=self._temperature,
                tools=AGENT_TOOLS,
                stream=True,
            )

            # Accumulate the streamed response
            content_parts: list[str] = []
            tool_calls_data: dict[int, dict[str, Any]] = {}
            finish_reason = None

            async for chunk in response:
                choice = chunk.choices[0]
                finish_reason = choice.finish_reason or finish_reason

                if choice.delta.content:
                    content_parts.append(choice.delta.content)
                    yield choice.delta.content

                if choice.delta.tool_calls:
                    for tc in choice.delta.tool_calls:
                        idx = tc.index
                        if idx not in tool_calls_data:
                            tool_calls_data[idx] = {
                                "id": tc.id or "",
                                "name": "",
                                "arguments": "",
                            }
                        if tc.id:
                            tool_calls_data[idx]["id"] = tc.id
                        if tc.function:
                            if tc.function.name:
                                tool_calls_data[idx]["name"] = tc.function.name
                            if tc.function.arguments:
                                tool_calls_data[idx]["arguments"] += tc.function.arguments

            if finish_reason != "tool_calls" or not tool_calls_data:
                # No tool calls — we're done
                break

            # Build the assistant message with tool_calls for the message history
            full_content = "".join(content_parts) or None
            assistant_msg: dict[str, Any] = {
                "role": "assistant",
                "content": full_content,
                "tool_calls": [
                    {
                        "id": tc["id"],
                        "type": "function",
                        "function": {
                            "name": tc["name"],
                            "arguments": tc["arguments"],
                        },
                    }
                    for tc in tool_calls_data.values()
                ],
            }
            working_messages.append(assistant_msg)

            # Execute each tool call
            for tc in tool_calls_data.values():
                # Emit tool_call event
                yield json.dumps({
                    "type": "tool_call",
                    "name": tc["name"],
                    "arguments": tc["arguments"],
                })

                result = execute_tool(project, tc["name"], tc["arguments"])

                # Emit tool_result event
                yield json.dumps({
                    "type": "tool_result",
                    "name": tc["name"],
                    "content": result[:2000],  # truncate for SSE display
                })

                working_messages.append({
                    "role": "tool",
                    "tool_call_id": tc["id"],
                    "content": result,
                })

            # Loop back for next round with tool results
