import tempfile
import unittest
from pathlib import Path

from automation.youtube_uploader import (
    UploadManifest,
    assert_upload_allowed,
    fingerprint_file,
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


if __name__ == "__main__":
    unittest.main()
