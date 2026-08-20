from __future__ import annotations

import argparse
import hashlib
import json
from dataclasses import asdict, dataclass, field
from pathlib import Path


YOUTUBE_UPLOAD_SCOPE = "https://www.googleapis.com/auth/youtube.upload"


@dataclass(frozen=True)
class UploadManifest:
    title: str
    description: str
    tags: list[str] = field(default_factory=list)
    category_id: str = "27"
    privacy_status: str = "private"
    contains_synthetic_media: bool = True


def assert_upload_allowed(
    manifest: UploadManifest, *, approve_public: bool = False
) -> None:
    allowed = {"private", "unlisted", "public"}
    if manifest.privacy_status not in allowed:
        raise ValueError(f"Unsupported privacy status: {manifest.privacy_status}")
    if manifest.privacy_status != "private" and not approve_public:
        raise ValueError("Non-private upload requires explicit approval")


def fingerprint_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def load_manifest(path: Path) -> UploadManifest:
    return UploadManifest(**json.loads(path.read_text(encoding="utf-8")))


def authorize(client_secrets: Path, token_path: Path):
    from google.auth.transport.requests import Request
    from google.oauth2.credentials import Credentials
    from google_auth_oauthlib.flow import InstalledAppFlow

    credentials = None
    if token_path.exists():
        credentials = Credentials.from_authorized_user_file(
            str(token_path), [YOUTUBE_UPLOAD_SCOPE]
        )
    if credentials and credentials.expired and credentials.refresh_token:
        credentials.refresh(Request())
    if not credentials or not credentials.valid:
        flow = InstalledAppFlow.from_client_secrets_file(
            str(client_secrets), [YOUTUBE_UPLOAD_SCOPE]
        )
        credentials = flow.run_local_server(port=0)
    token_path.parent.mkdir(parents=True, exist_ok=True)
    token_path.write_text(credentials.to_json(), encoding="utf-8")
    return credentials


def upload_video(video_path: Path, manifest: UploadManifest, credentials) -> str:
    from googleapiclient.discovery import build
    from googleapiclient.http import MediaFileUpload

    youtube = build("youtube", "v3", credentials=credentials)
    body = {
        "snippet": {
            "title": manifest.title,
            "description": manifest.description,
            "tags": manifest.tags,
            "categoryId": manifest.category_id,
        },
        "status": {
            "privacyStatus": manifest.privacy_status,
            "selfDeclaredMadeForKids": False,
            "containsSyntheticMedia": manifest.contains_synthetic_media,
        },
    }
    request = youtube.videos().insert(
        part="snippet,status",
        body=body,
        media_body=MediaFileUpload(str(video_path), resumable=True),
    )
    response = None
    while response is None:
        _, response = request.next_chunk()
    return response["id"]


def upload_approved_video(
    video_path: Path,
    manifest: UploadManifest,
    *,
    credentials,
    approve_public: bool,
) -> dict[str, str]:
    """Upload one approved video and return a platform-neutral result."""
    assert_upload_allowed(manifest, approve_public=approve_public)
    video_id = upload_video(video_path, manifest, credentials)
    return {
        "id": video_id,
        "url": f"https://www.youtube.com/shorts/{video_id}",
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Safely upload a Short to YouTube")
    parser.add_argument("video", type=Path)
    parser.add_argument("manifest", type=Path)
    parser.add_argument("--client-secrets", type=Path, default=Path("client_secrets.json"))
    parser.add_argument("--token", type=Path, default=Path("automation/secrets/youtube_token.json"))
    parser.add_argument("--approve-non-private", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    manifest = load_manifest(args.manifest)
    assert_upload_allowed(manifest, approve_public=args.approve_non_private)
    if not args.video.exists():
        raise FileNotFoundError(args.video)
    summary = {**asdict(manifest), "video_sha256": fingerprint_file(args.video)}
    if args.dry_run:
        print(json.dumps(summary, ensure_ascii=False, indent=2))
        return
    credentials = authorize(args.client_secrets, args.token)
    video_id = upload_video(args.video, manifest, credentials)
    print(json.dumps({"video_id": video_id, "privacy": manifest.privacy_status}))


if __name__ == "__main__":
    main()

