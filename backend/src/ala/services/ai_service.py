"""OpenAI-compatible AI service with async streaming."""
from typing import AsyncIterator

from openai import AsyncOpenAI


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
