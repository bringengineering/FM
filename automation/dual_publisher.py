from __future__ import annotations

import argparse
import hashlib
import json
from copy import deepcopy
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable

from automation.instagram_uploader import (
    InstagramApiError,
    InstagramClient,
    InstagramConfig,
)
from automation.youtube_uploader import (
    UploadManifest,
    authorize,
    upload_approved_video,
)


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
        if not instagram.get("caption"):
            raise PublishBlocked("Instagram caption is required")
        if instagram.get("video_url") and instagram.get("video_path"):
            raise PublishBlocked(
                "Choose only one Instagram source: video_url or video_path"
            )
        local_source = Path(instagram.get("video_path") or video)
        if not instagram.get("video_url") and not local_source.is_file():
            raise PublishBlocked(f"Instagram video file does not exist: {local_source}")
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


def youtube_manifest_from_job(job: dict) -> UploadManifest:
    metadata = job["youtube"]
    return UploadManifest(
        title=metadata["title"],
        description=metadata.get("description", ""),
        tags=list(metadata.get("tags", [])),
        category_id=str(metadata.get("category_id", "27")),
        privacy_status=metadata.get("privacy_status", "public"),
        contains_synthetic_media=True,
    )


def make_youtube_publisher(credentials, *, approve_public: bool):
    def publisher(job: dict) -> dict:
        return upload_approved_video(
            Path(job["video"]),
            youtube_manifest_from_job(job),
            credentials=credentials,
            approve_public=approve_public,
        )

    return publisher


def make_instagram_publisher(client: InstagramClient):
    def publisher(job: dict) -> dict:
        metadata = job["instagram"]
        if metadata.get("video_url"):
            creation_id = client.create_reel(
                video_url=metadata["video_url"], caption=metadata["caption"]
            )
        else:
            creation_id, upload_uri = client.create_resumable_reel(
                caption=metadata["caption"]
            )
            client.upload_local_video(
                upload_uri, Path(metadata.get("video_path") or job["video"])
            )
        client.wait_until_ready(creation_id)
        result = client.publish(creation_id)
        return {"id": result.media_id, "url": result.url}

    return publisher


def main() -> None:
    parser = argparse.ArgumentParser(description="Publish an approved video safely")
    parser.add_argument("manifest", type=Path)
    parser.add_argument("--target", choices=sorted(ALLOWED_TARGETS), default=None)
    parser.add_argument("--state-dir", type=Path, default=Path("automation/state/publish"))
    parser.add_argument("--client-secrets", type=Path, default=Path("client_secrets.json"))
    parser.add_argument("--youtube-token", type=Path, default=Path("automation/secrets/youtube_token.json"))
    parser.add_argument("--approve-public", action="store_true")
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
    credentials = authorize(args.client_secrets, args.youtube_token)
    instagram_client = InstagramClient.from_config(InstagramConfig.from_env())
    result = publish_manifest(
        manifest,
        state_dir=args.state_dir,
        youtube=make_youtube_publisher(
            credentials, approve_public=args.approve_public
        ),
        instagram=make_instagram_publisher(instagram_client),
    )
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
