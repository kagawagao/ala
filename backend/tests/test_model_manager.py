"""Unit tests for ModelManager."""

import json
import os
import stat

import pytest

from ala.services.model_manager import ModelManager


@pytest.fixture
def tmp_file(tmp_path):
    return tmp_path / "models.json"


@pytest.fixture
def manager(tmp_file):
    return ModelManager(storage_path=tmp_file)


# ---------------------------------------------------------------------------
# Built-in models
# ---------------------------------------------------------------------------


class TestBuiltins:
    def test_builtins_are_present(self, manager):
        builtins = [m for m in manager.list_models() if m.builtin]
        assert len(builtins) > 0

    def test_builtin_cannot_be_deleted(self, manager):
        builtin = next(m for m in manager.list_models() if m.builtin)
        with pytest.raises(ValueError, match="Built-in"):
            manager.delete_model(builtin.id)

    def test_builtin_cannot_be_updated(self, manager):
        builtin = next(m for m in manager.list_models() if m.builtin)
        with pytest.raises(ValueError, match="Built-in"):
            manager.update_model(builtin.id, name="hacked")

    def test_get_nonexistent_returns_none(self, manager):
        assert manager.get_model("does-not-exist") is None

    def test_delete_nonexistent_returns_false(self, manager):
        assert manager.delete_model("does-not-exist") is False


# ---------------------------------------------------------------------------
# CRUD + persistence across reloads
# ---------------------------------------------------------------------------


class TestPersistence:
    def test_create_persists_across_reload(self, tmp_file):
        m1 = ModelManager(storage_path=tmp_file)
        preset = m1.create_model(
            name="Test",
            provider="Custom",
            model_id="my-model",
            api_endpoint="http://localhost:11434",
        )

        m2 = ModelManager(storage_path=tmp_file)
        found = m2.get_model(preset.id)
        assert found is not None
        assert found.name == "Test"
        assert found.model_id == "my-model"

    def test_update_persists_across_reload(self, tmp_file):
        m1 = ModelManager(storage_path=tmp_file)
        preset = m1.create_model(
            name="Original",
            provider="Custom",
            model_id="my-model",
            api_endpoint="http://localhost:11434",
        )
        m1.update_model(preset.id, name="Updated")

        m2 = ModelManager(storage_path=tmp_file)
        found = m2.get_model(preset.id)
        assert found is not None
        assert found.name == "Updated"

    def test_delete_persists_across_reload(self, tmp_file):
        m1 = ModelManager(storage_path=tmp_file)
        preset = m1.create_model(
            name="ToDelete",
            provider="Custom",
            model_id="bye-model",
            api_endpoint="http://localhost:11434",
        )
        assert m1.delete_model(preset.id) is True

        m2 = ModelManager(storage_path=tmp_file)
        assert m2.get_model(preset.id) is None

    def test_builtins_always_refreshed_on_load(self, tmp_file):
        """Reloading should always include the hard-coded built-ins even if
        the persisted file only has custom models."""
        m1 = ModelManager(storage_path=tmp_file)
        m1.create_model(
            name="Custom",
            provider="Custom",
            model_id="c",
            api_endpoint="http://localhost",
        )

        m2 = ModelManager(storage_path=tmp_file)
        builtins = [m for m in m2.list_models() if m.builtin]
        assert len(builtins) > 0


# ---------------------------------------------------------------------------
# anthropic_compatible handling
# ---------------------------------------------------------------------------


class TestAnthropicCompatible:
    def test_create_with_null(self, manager):
        preset = manager.create_model(
            name="Null Compat",
            provider="Custom",
            model_id="m",
            api_endpoint="http://host",
            anthropic_compatible=None,
        )
        assert preset.anthropic_compatible is None

    def test_create_with_true(self, manager):
        preset = manager.create_model(
            name="Compat True",
            provider="Custom",
            model_id="m2",
            api_endpoint="http://host",
            anthropic_compatible=True,
        )
        assert preset.anthropic_compatible is True

    def test_update_leaves_compat_unchanged_when_unset(self, tmp_file):
        from ala.services.model_manager import _UNSET

        m = ModelManager(storage_path=tmp_file)
        preset = m.create_model(
            name="M",
            provider="Custom",
            model_id="m3",
            api_endpoint="http://host",
            anthropic_compatible=True,
        )
        m.update_model(preset.id, anthropic_compatible=_UNSET)
        updated = m.get_model(preset.id)
        assert updated is not None
        assert updated.anthropic_compatible is True


# ---------------------------------------------------------------------------
# Corrupt / partial JSON handling
# ---------------------------------------------------------------------------


class TestCorruptJson:
    def test_corrupt_json_falls_back_to_builtins(self, tmp_file):
        tmp_file.parent.mkdir(parents=True, exist_ok=True)
        tmp_file.write_text("{ not valid json }", encoding="utf-8")

        manager = ModelManager(storage_path=tmp_file)
        builtins = [m for m in manager.list_models() if m.builtin]
        assert len(builtins) > 0

    def test_partial_entry_is_skipped(self, tmp_file):
        tmp_file.parent.mkdir(parents=True, exist_ok=True)
        # Entry missing required fields for ModelPreset dataclass
        data = [{"id": "bad", "builtin": False, "unknown_field_only": True}]
        tmp_file.write_text(json.dumps(data), encoding="utf-8")

        manager = ModelManager(storage_path=tmp_file)
        # Should not crash and builtins still present
        builtins = [m for m in manager.list_models() if m.builtin]
        assert len(builtins) > 0


# ---------------------------------------------------------------------------
# Read-only / IO-error resilience
# ---------------------------------------------------------------------------


class TestReadOnlyStorage:
    @pytest.mark.skipif(
        os.name == "nt", reason="Windows uses ACL-based permissions instead of POSIX chmod"
    )
    def test_readonly_dir_does_not_crash_startup(self, tmp_path):
        ro_dir = tmp_path / "readonly"
        ro_dir.mkdir()
        storage_path = ro_dir / "models.json"

        # Remove write permission from the directory
        ro_dir.chmod(stat.S_IRUSR | stat.S_IXUSR)
        try:
            # Must not raise even though we cannot write the file
            manager = ModelManager(storage_path=storage_path)
            builtins = [m for m in manager.list_models() if m.builtin]
            assert len(builtins) > 0
        finally:
            ro_dir.chmod(stat.S_IRWXU)
