from dataclasses import FrozenInstanceError
from datetime import datetime, timezone
import json
import threading
import time

import pytest


NOW = datetime(2026, 8, 20, 1, 2, 3, tzinfo=timezone.utc)
EXPECTED_KEYS = {
    "request_id",
    "update_id",
    "created_at",
    "post_id",
    "kind",
    "content",
    "status",
}


def _run_concurrently(*operations):
    start = threading.Barrier(len(operations))
    errors = []

    def run(operation):
        try:
            start.wait(timeout=2)
            operation()
        except BaseException as exc:
            errors.append(exc)

    threads = [threading.Thread(target=run, args=(operation,)) for operation in operations]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=5)
    assert not any(thread.is_alive() for thread in threads)
    assert errors == []


def _slow_reads(store):
    original = store._read

    def slow_read():
        records = original()
        time.sleep(0.15)
        return records

    store._read = slow_read


def test_revision_request_is_immutable_and_persists_korean(tmp_path):
    from automation.bringcare_telegram.revisions import RevisionStore

    path = tmp_path / "revisions.json"
    record = RevisionStore(path).add(101, "post-1", "title", "  새 제목입니다  ", now=NOW)

    assert record.request_id == "revision-101"
    assert record.created_at == NOW.isoformat()
    assert record.content == "새 제목입니다"
    with pytest.raises(FrozenInstanceError):
        record.status = "applied"
    raw = path.read_text(encoding="utf-8")
    assert "새 제목입니다" in raw
    assert "\\uc0c8" not in raw


def test_add_is_idempotent_by_update_id(tmp_path):
    from automation.bringcare_telegram.revisions import RevisionStore

    store = RevisionStore(tmp_path / "revisions.json")
    first = store.add(9, "post-1", "body", "첫 요청", now=NOW)
    duplicate = store.add(9, "post-2", "title", "다른 요청", now=NOW)

    assert duplicate == first
    assert store.list() == [first]


@pytest.mark.parametrize(
    ("update_id", "post_id", "kind", "content"),
    [
        (-1, "post-1", "title", "제목"),
        (True, "post-1", "title", "제목"),
        (1, "", "title", "제목"),
        (1, "   ", "title", "제목"),
        (1, 3, "title", "제목"),
        (1, "post-1", "summary", "제목"),
        (1, "post-1", [], "제목"),
        (1, "post-1", "body", "  "),
        (1, "post-1", "body", None),
    ],
)
def test_add_rejects_invalid_input(tmp_path, update_id, post_id, kind, content):
    from automation.bringcare_telegram.revisions import RevisionStore

    with pytest.raises(ValueError):
        RevisionStore(tmp_path / "revisions.json").add(
            update_id, post_id, kind, content, now=NOW
        )


def test_storage_has_only_version_and_strict_record_schema(tmp_path):
    from automation.bringcare_telegram.revisions import RevisionStore

    path = tmp_path / "revisions.json"
    RevisionStore(path).add(
        10, "post-1", "body", "token password cookie are ordinary content", now=NOW
    )

    document = json.loads(path.read_text(encoding="utf-8"))
    assert set(document) == {"schema_version", "requests"}
    assert document["schema_version"] == 1
    assert set(document["requests"][0]) == EXPECTED_KEYS
    assert not ({"token", "password", "cookie"} & set(document["requests"][0]))
    assert "token password cookie" in document["requests"][0]["content"]


@pytest.mark.parametrize(
    "document",
    [
        "not json",
        json.dumps({"schema_version": 1, "requests": [{"request_id": "made-up"}]}),
        json.dumps({"schema_version": 1, "requests": [], "token": "secret"}),
        json.dumps({"schema_version": 99, "requests": []}),
    ],
)
def test_malformed_storage_returns_empty_without_overwriting(tmp_path, document):
    from automation.bringcare_telegram.revisions import RevisionStore

    path = tmp_path / "revisions.json"
    path.write_text(document, encoding="utf-8")

    assert RevisionStore(path).list() == []
    assert path.read_text(encoding="utf-8") == document


def test_status_transitions_are_terminal_and_unknown_is_explicit(tmp_path):
    from automation.bringcare_telegram.revisions import RevisionStore, UnknownRevisionRequest

    store = RevisionStore(tmp_path / "revisions.json")
    applied = store.apply(store.add(20, "post-1", "title", "제목", now=NOW).request_id)
    assert applied.status == "applied"
    assert store.cancel(applied.request_id) == applied

    cancelled = store.cancel(store.add(21, "post-1", "body", "본문", now=NOW).request_id)
    assert cancelled.status == "cancelled"
    assert store.apply(cancelled.request_id) == cancelled
    with pytest.raises(UnknownRevisionRequest):
        store.apply("revision-404")


def test_write_uses_atomic_replace(tmp_path, monkeypatch):
    import automation.bringcare_telegram.revisions as revisions

    calls = []
    real_replace = revisions.os.replace

    def capture_replace(source, destination):
        calls.append((source, destination))
        real_replace(source, destination)

    monkeypatch.setattr(revisions.os, "replace", capture_replace)
    path = tmp_path / "nested" / "revisions.json"
    revisions.RevisionStore(path).add(30, "post-1", "title", "제목", now=NOW)

    assert len(calls) == 1
    source, destination = calls[0]
    assert destination == path
    assert source.parent == path.parent
    assert source != path


def test_concurrent_adds_preserve_both_requests(tmp_path):
    from automation.bringcare_telegram.revisions import RevisionStore

    path = tmp_path / "revisions.json"
    first = RevisionStore(path)
    second = RevisionStore(path)
    _slow_reads(first)
    _slow_reads(second)

    _run_concurrently(
        lambda: first.add(40, "post-1", "title", "제목", now=NOW),
        lambda: second.add(41, "post-1", "body", "본문", now=NOW),
    )

    assert {record.update_id for record in RevisionStore(path).list()} == {40, 41}


def test_concurrent_add_and_transition_preserve_both_changes(tmp_path):
    from automation.bringcare_telegram.revisions import RevisionStore

    path = tmp_path / "revisions.json"
    seed = RevisionStore(path)
    request = seed.add(50, "post-1", "title", "제목", now=NOW)
    adding = RevisionStore(path)
    applying = RevisionStore(path)
    _slow_reads(adding)
    _slow_reads(applying)

    _run_concurrently(
        lambda: adding.add(51, "post-1", "body", "본문", now=NOW),
        lambda: applying.apply(request.request_id),
    )

    records = RevisionStore(path).list()
    assert {record.update_id for record in records} == {50, 51}
    assert next(record for record in records if record.update_id == 50).status == "applied"


def test_lock_wait_is_bounded_and_release_allows_next_writer(tmp_path):
    from automation.bringcare_telegram.revisions import (
        RevisionStore,
        RevisionStoreLockTimeout,
    )

    path = tmp_path / "revisions.json"
    holder = RevisionStore(path)
    waiting = RevisionStore(path, lock_timeout=0.05)
    attempted = threading.Event()
    errors = []

    def attempt_add():
        attempted.set()
        try:
            waiting.add(60, "post-1", "title", "제목", now=NOW)
        except BaseException as exc:
            errors.append(exc)

    with holder._locked():
        thread = threading.Thread(target=attempt_add)
        thread.start()
        assert attempted.wait(timeout=1)
        thread.join(timeout=1)
        assert not thread.is_alive()
        assert len(errors) == 1
        assert isinstance(errors[0], RevisionStoreLockTimeout)

    assert waiting.add(60, "post-1", "title", "제목", now=NOW).update_id == 60
