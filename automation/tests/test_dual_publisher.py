import json
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from automation.dual_publisher import PublishBlocked, publish_manifest
from automation.instagram_uploader import InstagramApiError


class FakePublisher:
    def __init__(self, outcomes):
        self.outcomes = list(outcomes)
        self.calls = []

    def __call__(self, job):
        self.calls.append(job)
        outcome = self.outcomes.pop(0)
        if isinstance(outcome, Exception):
            raise outcome
        return outcome


def valid_manifest(root: Path) -> dict:
    video = root / "video.mp4"
    video.write_bytes(b"video")
    return {
        "video": str(video),
        "target": "both",
        "approval": {
            "approved": True,
            "approved_at": "2026-08-20T01:00:00+09:00",
            "approved_by": "telegram-owner",
        },
        "qc": {
            "required_gates": ["audio", "captions", "aspect"],
            "audio": True,
            "captions": True,
            "aspect": True,
        },
        "youtube": {"title": "title", "description": "description"},
        "instagram": {
            "caption": "caption",
            "video_url": "https://media.example/video.mp4",
        },
    }


class DualPublisherTests(unittest.TestCase):
    def test_publish_requires_explicit_approval(self):
        with TemporaryDirectory() as folder:
            manifest = valid_manifest(Path(folder))
            manifest["approval"]["approved"] = False
            youtube = FakePublisher([{"id": "yt1", "url": "yt"}])
            instagram = FakePublisher([{"id": "ig1", "url": "ig"}])
            with self.assertRaises(PublishBlocked):
                publish_manifest(
                    manifest,
                    state_dir=Path(folder) / "state",
                    youtube=youtube,
                    instagram=instagram,
                )
            self.assertEqual([], youtube.calls)
            self.assertEqual([], instagram.calls)

    def test_failed_qc_blocks_both_platforms(self):
        with TemporaryDirectory() as folder:
            manifest = valid_manifest(Path(folder))
            manifest["qc"]["captions"] = False
            with self.assertRaises(PublishBlocked):
                publish_manifest(
                    manifest,
                    state_dir=Path(folder) / "state",
                    youtube=FakePublisher([]),
                    instagram=FakePublisher([]),
                )

    def test_partial_success_retries_only_failed_platform(self):
        with TemporaryDirectory() as folder:
            root = Path(folder)
            manifest = valid_manifest(root)
            youtube = FakePublisher([{"id": "yt1", "url": "https://youtu.be/yt1"}])
            instagram = FakePublisher(
                [
                    InstagramApiError("temporary", retryable=True),
                    {"id": "ig1", "url": "https://instagram.com/p/ig1"},
                ]
            )

            first = publish_manifest(
                manifest,
                state_dir=root / "state",
                youtube=youtube,
                instagram=instagram,
            )
            second = publish_manifest(
                manifest,
                state_dir=root / "state",
                youtube=youtube,
                instagram=instagram,
            )

            self.assertEqual("published", first["platforms"]["youtube"]["status"])
            self.assertEqual(
                "failed_retryable", first["platforms"]["instagram"]["status"]
            )
            self.assertEqual("published", second["platforms"]["instagram"]["status"])
            self.assertEqual(1, len(youtube.calls))
            self.assertEqual(2, len(instagram.calls))

    def test_state_file_does_not_contain_access_tokens(self):
        with TemporaryDirectory() as folder:
            root = Path(folder)
            manifest = valid_manifest(root)
            publish_manifest(
                manifest,
                state_dir=root / "state",
                youtube=FakePublisher([{"id": "yt1", "url": "yt"}]),
                instagram=FakePublisher([{"id": "ig1", "url": "ig"}]),
            )
            text = next((root / "state").glob("*.json")).read_text(encoding="utf-8")
            self.assertNotIn("access_token", text.lower())
            json.loads(text)


if __name__ == "__main__":
    unittest.main()
