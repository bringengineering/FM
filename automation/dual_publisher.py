from __future__ import annotations

import argparse
import hashlib
import json
from copy import deepcopy
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable

from automation.instagram_uploader import InstagramApiError


ALLOWED_TARGETS = {"both", "youtube", "instagram", "hold"}


class PublishBlocked(RuntimeError):
    pass


def video_fingerprint(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def validate_publish_manifest(manifest: dict) -> Path:
    video = Path(manifest.get("video", ""))
    if not video.is_file():
        raise PublishBlocked(f"Video file does not exist: {video}")
    target = manifest.get("target", "both")
    if target not in ALLOWED_TARGETS:
        raise PublishBlocked(f"Unsupported publish target: {target}")
    if target == "hold":
        raise PublishBlocked("Publish target is on hold")
    approval = manifest.get("approval", {})
    if approval.get("approved") is not True or not approval.get("approved_at"):
        raise PublishBlocked("Explicit publish approval is required")
    qc = manifest.get("qc", {})
    failed = [gate for gate in qc.get("required_gates", []) if qc.get(gate) is not True]
    if failed:
        raise PublishBlocked("Required QC gates failed: " + ", ".join(failed))
    if target in {"both", "youtube"} and not manifest.get("youtube"):
        raise PublishBlocked("YouTube metadata is required")
    if target in {"both", "instagram"}:
        instagram = manifest.get("instagram", {})
        if not instagram.get("video_url") or not instagram.get("caption"):
            raise PublishBlocked("Instagram video_url and caption are required")
    return video


def _initial_state(fingerprint: str, target: str) -> dict:
    selected = {
        "youtube": target in {"both", "youtube"},
        "instagram": target in {"both", "instagram"},
    }
    return {
        "fingerprint": fingerprint,
        "platforms": {
            name: {
                "status": "pending" if enabled else "skipped",
                "attempts": 0,
                "id": None,
                "url": None,
                "last_error": None,
            }
            for name, enabled in selected.items()
        },
    }


def _read_state(path: Path, fingerprint: str, target: str) -> dict:
    if not path.exists():
        return _initial_state(fingerprint, target)
    state = json.loads(path.read_text(encoding="utf-8"))
    if state.get("fingerprint") != fingerprint:
        raise PublishBlocked("Publish state fingerprint does not match video")
    return state


def _write_state(path: Path, state: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(
        json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    temporary.replace(path)


def _safe_error(error: Exception) -> str:
    text = str(error)
    for marker in ("access_token=", "Bearer "):
        if marker in text:
            return type(error).__name__
    return text[:500]


def _publish_one(
    state: dict, platform: str, publisher: Callable[[dict], dict], job: dict
) -> None:
    record = state["platforms"][platform]
    if record["status"] not in {"pending", "failed_retryable"}:
        return
    record["status"] = "publishing"
    record["attempts"] += 1
    record["last_error"] = None
    try:
        result = publisher(job)
    except InstagramApiError as error:
        record["status"] = (
            "failed_retryable" if error.retryable else "failed_terminal"
        )
        record["last_error"] = _safe_error(error)
        return
    except Exception as error:
        record["status"] = "failed_terminal"
        record["last_error"] = _safe_error(error)
        return
    record.update(
        {
            "status": "published",
            "id": result.get("id"),
            "url": result.get("url"),
            "published_at": datetime.now(timezone.utc).isoformat(),
        }
    )


def publish_manifest(
    manifest: dict,
    *,
    state_dir: Path,
    youtube: Callable[[dict], dict],
    instagram: Callable[[dict], dict],
) -> dict:
    video = validate_publish_manifest(manifest)
    fingerprint = video_fingerprint(video)
    state_path = state_dir / f"{fingerprint}.json"
    state = _read_state(state_path, fingerprint, manifest.get("target", "both"))
    job = deepcopy(manifest)
    job["fingerprint"] = fingerprint

    for name, publisher in (("youtube", youtube), ("instagram", instagram)):
        _publish_one(state, name, publisher, job)
        _write_state(state_path, state)
    return deepcopy(state)


def load_publish_manifest(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def main() -> None:
    parser = argparse.ArgumentParser(description="Publish an approved video safely")
    parser.add_argument("manifest", type=Path)
    parser.add_argument("--target", choices=sorted(ALLOWED_TARGETS), default=None)
    parser.add_argument("--state-dir", type=Path, default=Path("automation/state/publish"))
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    manifest = load_publish_manifest(args.manifest)
    if args.target:
        manifest["target"] = args.target
    video = validate_publish_manifest(manifest)
    summary = {
        "video": str(video),
        "fingerprint": video_fingerprint(video),
        "target": manifest.get("target", "both"),
        "approved_at": manifest["approval"]["approved_at"],
    }
    if args.dry_run:
        print(json.dumps(summary, ensure_ascii=False, indent=2))
        return
    raise SystemExit("Live publishers must be provided by the approval worker")


if __name__ == "__main__":
    main()
