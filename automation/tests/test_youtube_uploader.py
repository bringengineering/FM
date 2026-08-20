import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from automation.youtube_uploader import (
    UploadManifest,
    assert_upload_allowed,
    fingerprint_file,
    upload_approved_video,
)


class UploadSafetyTests(unittest.TestCase):
    def test_defaults_to_private(self):
        manifest = UploadManifest(title="테스트", description="설명")
        self.assertEqual(manifest.privacy_status, "private")

    def test_public_upload_requires_explicit_approval(self):
        manifest = UploadManifest(
            title="테스트", description="설명", privacy_status="public"
        )
        with self.assertRaisesRegex(ValueError, "explicit approval"):
            assert_upload_allowed(manifest, approve_public=False)

    def test_public_upload_is_allowed_with_explicit_approval(self):
        manifest = UploadManifest(
            title="테스트", description="설명", privacy_status="public"
        )
        assert_upload_allowed(manifest, approve_public=True)

    def test_file_fingerprint_is_stable_and_content_sensitive(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "video.mp4"
            path.write_bytes(b"first")
            first = fingerprint_file(path)
            self.assertEqual(first, fingerprint_file(path))
            path.write_bytes(b"second")
            self.assertNotEqual(first, fingerprint_file(path))

    def test_approved_video_adapter_returns_canonical_short_url(self):
        manifest = UploadManifest(
            title="테스트",
            description="설명",
            privacy_status="public",
            contains_synthetic_media=True,
        )
        with patch("automation.youtube_uploader.upload_video", return_value="abc123"):
            result = upload_approved_video(
                Path("video.mp4"),
                manifest,
                credentials=object(),
                approve_public=True,
            )
        self.assertEqual("abc123", result["id"])
        self.assertEqual("https://www.youtube.com/shorts/abc123", result["url"])

    def test_approved_video_adapter_keeps_public_approval_gate(self):
        manifest = UploadManifest(
            title="테스트", description="설명", privacy_status="public"
        )
        with self.assertRaisesRegex(ValueError, "explicit approval"):
            upload_approved_video(
                Path("video.mp4"),
                manifest,
                credentials=object(),
                approve_public=False,
            )


if __name__ == "__main__":
    unittest.main()
