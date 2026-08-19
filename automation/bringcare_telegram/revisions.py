from __future__ import annotations

import json
import os
from dataclasses import asdict, dataclass, replace
from datetime import datetime, timezone
from pathlib import Path
from tempfile import NamedTemporaryFile
from typing import Any


SCHEMA_VERSION = 1
KINDS = {"title", "body"}
STATUSES = {"requested", "applied", "cancelled"}
RECORD_KEYS = {
    "request_id",
    "update_id",
    "created_at",
    "post_id",
    "kind",
    "content",
    "status",
}


class UnknownRevisionRequest(KeyError):
    """Raised when a revision request identifier is not stored."""


class MalformedRevisionStore(ValueError):
    """Raised when a write is attempted against malformed stored data."""


@dataclass(frozen=True)
class RevisionRequest:
    request_id: str
    update_id: int
    created_at: str
    post_id: str
    kind: str
    content: str
    status: str


def _timestamp(value: datetime) -> str:
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc).isoformat()


def _request_id(update_id: int) -> str:
    return f"revision-{update_id}"


def _record(value: Any) -> RevisionRequest:
    if not isinstance(value, dict) or set(value) != RECORD_KEYS:
        raise ValueError("Invalid revision request schema")
    record = RevisionRequest(**value)
    if (
        not isinstance(record.update_id, int)
        or isinstance(record.update_id, bool)
        or record.update_id < 0
        or record.request_id != _request_id(record.update_id)
        or not isinstance(record.post_id, str)
        or not record.post_id.strip()
        or record.kind not in KINDS
        or not isinstance(record.content, str)
        or not record.content.strip()
        or record.status not in STATUSES
        or not isinstance(record.created_at, str)
    ):
        raise ValueError("Invalid revision request")
    datetime.fromisoformat(record.created_at)
    return record


class RevisionStore:
    def __init__(self, path: str | Path):
        self.path = Path(path)

    def _read(self) -> list[RevisionRequest]:
        if not self.path.exists():
            return []
        try:
            document = json.loads(self.path.read_text(encoding="utf-8"))
            if (
                not isinstance(document, dict)
                or set(document) != {"schema_version", "requests"}
                or document["schema_version"] != SCHEMA_VERSION
                or not isinstance(document["requests"], list)
            ):
                raise ValueError("Invalid revision store schema")
            return [_record(item) for item in document["requests"]]
        except (OSError, TypeError, ValueError, KeyError) as exc:
            raise MalformedRevisionStore("Malformed revision store") from exc

    def list(self) -> list[RevisionRequest]:
        try:
            return list(self._read())
        except MalformedRevisionStore:
            return []

    def _write(self, records: list[RevisionRequest]) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        temporary: Path | None = None
        try:
            with NamedTemporaryFile(
                mode="w",
                encoding="utf-8",
                dir=self.path.parent,
                prefix=f".{self.path.name}.",
                suffix=".tmp",
                delete=False,
            ) as handle:
                json.dump(
                    {
                        "schema_version": SCHEMA_VERSION,
                        "requests": [asdict(record) for record in records],
                    },
                    handle,
                    ensure_ascii=False,
                    indent=2,
                )
                handle.write("\n")
                temporary = Path(handle.name)
            os.replace(temporary, self.path)
        finally:
            if temporary is not None and temporary.exists():
                temporary.unlink()

    def add(
        self,
        update_id: int,
        post_id: str,
        kind: str,
        content: str,
        *,
        now: datetime | None = None,
    ) -> RevisionRequest:
        if not isinstance(update_id, int) or isinstance(update_id, bool) or update_id < 0:
            raise ValueError("update_id must be a non-negative integer")
        if not isinstance(post_id, str) or not post_id.strip():
            raise ValueError("post_id must be a non-empty string")
        if not isinstance(kind, str) or kind not in KINDS:
            raise ValueError("kind must be title or body")
        if not isinstance(content, str) or not content.strip():
            raise ValueError("content must be non-empty")

        records = self._read()
        for record in records:
            if record.update_id == update_id:
                return record
        record = RevisionRequest(
            request_id=_request_id(update_id),
            update_id=update_id,
            created_at=_timestamp(now or datetime.now(timezone.utc)),
            post_id=post_id.strip(),
            kind=kind,
            content=content.strip(),
            status="requested",
        )
        self._write([*records, record])
        return record

    def _transition(self, request_id: str, status: str) -> RevisionRequest:
        records = self._read()
        for index, current in enumerate(records):
            if current.request_id != request_id:
                continue
            if current.status != "requested":
                return current
            updated = replace(current, status=status)
            records[index] = updated
            self._write(records)
            return updated
        raise UnknownRevisionRequest(request_id)

    def apply(self, request_id: str) -> RevisionRequest:
        return self._transition(request_id, "applied")

    def cancel(self, request_id: str) -> RevisionRequest:
        return self._transition(request_id, "cancelled")
