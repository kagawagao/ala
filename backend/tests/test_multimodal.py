"""Tests for multimodal (image) chat input.

Covers the provider-level content conversion, message normalisation, and the
chat API's attachment validation (media type, size, count, model capability).
"""

import base64

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from ala.api.chat import Attachment, _validate_attachments
from ala.main import create_app
from ala.services.ai_service import (
    MAX_IMAGE_ATTACHMENTS,
    MAX_IMAGE_BYTES,
    AIService,
    build_multimodal_content,
)

# Contents are irrelevant to validation — only the declared media type and
# base64 encoding are checked.  A valid PNG signature keeps it realistic.
PNG_BASE64 = base64.b64encode(b"\x89PNG\r\n\x1a\n" + b"\x00" * 64).decode()


@pytest.fixture
def client():
    with TestClient(create_app()) as c:
        yield c


def _att(media_type: str = "image/png", data: str = PNG_BASE64) -> Attachment:
    return Attachment(media_type=media_type, data=data)


class TestBuildMultimodalContent:
    def test_plain_string_when_no_attachments(self):
        assert build_multimodal_content("hi", [], use_anthropic=True) == "hi"

    def test_anthropic_emits_image_block_before_text(self):
        blocks = build_multimodal_content(
            "what is this?", [{"media_type": "image/png", "data": PNG_BASE64}], use_anthropic=True
        )
        assert blocks[0] == {
            "type": "image",
            "source": {"type": "base64", "media_type": "image/png", "data": PNG_BASE64},
        }
        assert blocks[1] == {"type": "text", "text": "what is this?"}

    def test_anthropic_omits_text_block_when_prompt_empty(self):
        blocks = build_multimodal_content(
            "", [{"media_type": "image/png", "data": PNG_BASE64}], use_anthropic=True
        )
        assert [b["type"] for b in blocks] == ["image"]

    def test_openai_emits_data_url_part(self):
        parts = build_multimodal_content(
            "what is this?", [{"media_type": "image/webp", "data": PNG_BASE64}], use_anthropic=False
        )
        assert parts[0] == {"type": "text", "text": "what is this?"}
        assert parts[1]["type"] == "image_url"
        assert parts[1]["image_url"]["url"] == f"data:image/webp;base64,{PNG_BASE64}"

    def test_multiple_images_preserve_order(self):
        attachments = [
            {"media_type": "image/png", "data": PNG_BASE64},
            {"media_type": "image/jpeg", "data": PNG_BASE64},
        ]
        parts = build_multimodal_content("two", attachments, use_anthropic=False)
        assert [p["type"] for p in parts] == ["text", "image_url", "image_url"]
        assert "image/jpeg" in parts[2]["image_url"]["url"]


class TestMessageNormalization:
    """``_normalize_messages`` must always strip the non-standard attachments key."""

    @staticmethod
    def _service(**kwargs) -> AIService:
        return AIService(
            api_endpoint=kwargs.pop("api_endpoint", "https://api.anthropic.com"),
            api_key="test-key",
            model="claude-sonnet-5",
            **kwargs,
        )

    def test_text_only_messages_pass_through_unchanged(self):
        service = self._service()
        messages = [{"role": "user", "content": "hello"}]
        assert service._normalize_messages(messages) == messages

    def test_attachments_converted_for_anthropic(self):
        service = self._service(use_anthropic=True)
        out = service._normalize_messages(
            [
                {
                    "role": "user",
                    "content": "hi",
                    "attachments": [{"media_type": "image/png", "data": PNG_BASE64}],
                }
            ]
        )
        assert "attachments" not in out[0]
        assert out[0]["content"][0]["type"] == "image"
        assert out[0]["content"][1] == {"type": "text", "text": "hi"}

    def test_attachments_converted_for_openai(self):
        service = self._service(api_endpoint="https://api.openai.com/v1", use_anthropic=False)
        out = service._normalize_messages(
            [
                {
                    "role": "user",
                    "content": "hi",
                    "attachments": [{"media_type": "image/png", "data": PNG_BASE64}],
                }
            ]
        )
        assert "attachments" not in out[0]
        assert out[0]["content"][0] == {"type": "text", "text": "hi"}
        assert out[0]["content"][1]["type"] == "image_url"

    def test_null_attachments_key_is_stripped(self):
        service = self._service(use_anthropic=True)
        out = service._normalize_messages([{"role": "user", "content": "hi", "attachments": None}])
        assert out[0] == {"role": "user", "content": "hi"}


class TestAttachmentValidation:
    def test_accepts_supported_image(self):
        assert _validate_attachments([_att()]) == [
            {"type": "image", "media_type": "image/png", "data": PNG_BASE64}
        ]

    def test_normalizes_media_type_case(self):
        assert _validate_attachments([_att(media_type="IMAGE/PNG")])[0]["media_type"] == "image/png"

    def test_accepts_data_url_payload(self):
        validated = _validate_attachments([_att(data=f"data:image/jpeg;base64,{PNG_BASE64}")])
        assert validated[0]["media_type"] == "image/jpeg"
        assert validated[0]["data"] == PNG_BASE64

    def test_rejects_unsupported_media_type(self):
        with pytest.raises(HTTPException) as exc:
            _validate_attachments([_att(media_type="image/tiff")])
        assert exc.value.status_code == 400

    def test_rejects_invalid_base64(self):
        with pytest.raises(HTTPException) as exc:
            _validate_attachments([_att(data="definitely-not-base64!!")])
        assert exc.value.status_code == 400

    def test_rejects_empty_payload(self):
        with pytest.raises(HTTPException):
            _validate_attachments([_att(data="")])

    def test_rejects_oversized_image(self):
        oversized = base64.b64encode(b"\x00" * (MAX_IMAGE_BYTES + 1)).decode()
        with pytest.raises(HTTPException) as exc:
            _validate_attachments([_att(data=oversized)])
        assert exc.value.status_code == 400

    def test_rejects_too_many_images(self):
        with pytest.raises(HTTPException) as exc:
            _validate_attachments([_att() for _ in range(MAX_IMAGE_ATTACHMENTS + 1)])
        assert exc.value.status_code == 400

    def test_empty_and_missing_lists_are_valid(self):
        assert _validate_attachments(None) == []
        assert _validate_attachments([]) == []


class TestChatAttachmentEndpoint:
    """Validation failures must surface as 400s before any provider call."""

    @staticmethod
    def _new_session(client) -> str:
        resp = client.post("/api/chat/sessions", json={"title": "s", "context_type": "general"})
        return resp.json()["id"]

    @staticmethod
    def _payload(model: str, attachments: list[dict]) -> dict:
        return {
            "message": "look at this",
            "attachments": attachments,
            "model_override": {
                "model": model,
                "api_endpoint": "https://api.anthropic.com",
                "api_key": "test-key",
            },
        }

    def test_rejects_images_for_text_only_model(self, client):
        session_id = self._new_session(client)
        resp = client.post(
            f"/api/chat/sessions/{session_id}/messages",
            json=self._payload("deepseek-v4-pro", [_att().model_dump()]),
        )
        assert resp.status_code == 400
        assert "does not accept image input" in resp.json()["detail"]

    def test_rejects_oversized_image(self, client):
        session_id = self._new_session(client)
        oversized = base64.b64encode(b"\x00" * (MAX_IMAGE_BYTES + 1)).decode()
        resp = client.post(
            f"/api/chat/sessions/{session_id}/messages",
            json=self._payload("claude-sonnet-5", [_att(data=oversized).model_dump()]),
        )
        assert resp.status_code == 400

    def test_rejects_unsupported_media_type(self, client):
        session_id = self._new_session(client)
        resp = client.post(
            f"/api/chat/sessions/{session_id}/messages",
            json=self._payload("claude-sonnet-5", [_att(media_type="image/bmp").model_dump()]),
        )
        assert resp.status_code == 400

    def test_rejects_too_many_images(self, client):
        session_id = self._new_session(client)
        many = [_att().model_dump() for _ in range(MAX_IMAGE_ATTACHMENTS + 1)]
        resp = client.post(
            f"/api/chat/sessions/{session_id}/messages",
            json=self._payload("claude-sonnet-5", many),
        )
        assert resp.status_code == 400


class TestAttachmentPassthrough:
    """End-to-end: attachments must reach the AI layer as provider content blocks."""

    def test_images_reach_ai_service_as_anthropic_blocks(self, client, monkeypatch):
        import ala.api.chat as chat_module

        captured: dict = {}

        async def fake_stream(self, messages, **kwargs):  # noqa: ANN001, ANN003
            captured["messages"] = messages
            captured["use_anthropic"] = self._use_anthropic
            yield "ok"

        monkeypatch.setattr(chat_module.AIService, "stream_chat_agentic", fake_stream)

        session_id = TestChatAttachmentEndpoint._new_session(client)
        resp = client.post(
            f"/api/chat/sessions/{session_id}/messages",
            json=TestChatAttachmentEndpoint._payload("claude-sonnet-5", [_att().model_dump()]),
        )
        assert resp.status_code == 200
        assert captured["use_anthropic"] is True

        user_message = captured["messages"][-1]
        assert user_message["role"] == "user"
        assert user_message["content"] == "look at this"
        assert user_message["attachments"] == [
            {"type": "image", "media_type": "image/png", "data": PNG_BASE64}
        ]

        # The provider layer then converts those attachments into image blocks.
        normalized = TestMessageNormalization._service()._normalize_messages(captured["messages"])
        assert normalized[-1]["content"][0] == {
            "type": "image",
            "source": {"type": "base64", "media_type": "image/png", "data": PNG_BASE64},
        }
        assert normalized[-1]["content"][1] == {"type": "text", "text": "look at this"}

    def test_prior_turn_images_are_resent_from_history(self, client, monkeypatch):
        import ala.api.chat as chat_module

        captured: dict = {}

        async def fake_stream(self, messages, **kwargs):  # noqa: ANN001, ANN003
            captured["messages"] = messages
            yield "ok"

        monkeypatch.setattr(chat_module.AIService, "stream_chat_agentic", fake_stream)

        session_id = TestChatAttachmentEndpoint._new_session(client)
        payload = TestChatAttachmentEndpoint._payload("claude-sonnet-5", [])
        payload["history"] = [
            {"role": "user", "content": "earlier", "attachments": [_att().model_dump()]},
            {"role": "assistant", "content": "saw it"},
        ]
        resp = client.post(f"/api/chat/sessions/{session_id}/messages", json=payload)
        assert resp.status_code == 200

        earlier = captured["messages"][0]
        assert earlier["role"] == "user"
        assert earlier["attachments"] == [
            {"type": "image", "media_type": "image/png", "data": PNG_BASE64}
        ]
