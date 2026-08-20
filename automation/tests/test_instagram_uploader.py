import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from automation.instagram_uploader import (
    InstagramApiError,
    InstagramClient,
    InstagramConfig,
    InstagramConfigurationError,
    UrllibGraphTransport,
)


class RecordingTransport:
    def __init__(self, responses):
        self.responses = iter(responses)
        self.calls = []

    def request(self, method, path, *, params=None):
        self.calls.append((method, path, params or {}))
        response = next(self.responses)
        if isinstance(response, Exception):
            raise response
        return response


class FakeHttpResponse:
    def __init__(self, payload=b'{"success": true}'):
        self.payload = payload

    def __enter__(self):
        return self

    def __exit__(self, *_):
        return False

    def read(self):
        return self.payload


class RecordingOpener:
    def __init__(self):
        self.requests = []

    def __call__(self, request, timeout):
        self.requests.append((request, timeout))
        return FakeHttpResponse()


class InstagramTransportTests(unittest.TestCase):
    def test_upload_file_sends_binary_with_resumable_headers(self):
        with TemporaryDirectory() as folder:
            video = Path(folder) / "video.mp4"
            video.write_bytes(b"mp4-bytes")
            opener = RecordingOpener()
            transport = UrllibGraphTransport("secret-token", opener=opener)

            result = transport.upload_file(
                "https://rupload.facebook.com/ig-api-upload/v26.0/container-1",
                video,
            )

            self.assertEqual({"success": True}, result)
            request, timeout = opener.requests[0]
            self.assertEqual(b"mp4-bytes", request.data)
            self.assertEqual("OAuth secret-token", request.get_header("Authorization"))
            self.assertEqual("0", request.get_header("Offset"))
            self.assertEqual("9", request.get_header("File_size"))
            self.assertEqual(120, timeout)


class InstagramConfigTests(unittest.TestCase):
    def test_config_requires_secret_without_leaking_it(self):
        with self.assertRaises(InstagramConfigurationError) as caught:
            InstagramConfig.from_env({"INSTAGRAM_BUSINESS_ACCOUNT_ID": "1784"})
        self.assertIn("META_PAGE_ACCESS_TOKEN", str(caught.exception))

    def test_config_loads_ids_and_token(self):
        config = InstagramConfig.from_env(
            {
                "META_PAGE_ACCESS_TOKEN": "secret-token",
                "INSTAGRAM_BUSINESS_ACCOUNT_ID": "1784",
            }
        )
        self.assertEqual("1784", config.instagram_account_id)
        self.assertEqual("secret-token", config.access_token)

    def test_config_can_read_windows_user_environment(self):
        with patch(
            "automation.instagram_uploader._windows_user_environment",
            return_value={
                "META_PAGE_ACCESS_TOKEN": "registry-token",
                "INSTAGRAM_BUSINESS_ACCOUNT_ID": "1784",
            },
        ), patch("automation.instagram_uploader.os.environ", {}):
            config = InstagramConfig.from_env()
        self.assertEqual("registry-token", config.access_token)


class InstagramClientTests(unittest.TestCase):
    def test_create_wait_and_publish_reel(self):
        transport = RecordingTransport(
            [
                {"id": "container-1"},
                {"status_code": "IN_PROGRESS"},
                {"status_code": "FINISHED"},
                {"id": "media-1"},
                {"permalink": "https://www.instagram.com/reel/shortcode/"},
            ]
        )
        client = InstagramClient("1784", transport, poll_seconds=0)

        creation_id = client.create_reel(
            video_url="https://media.example/one.mp4", caption="caption"
        )
        with patch("automation.instagram_uploader.time.sleep"):
            client.wait_until_ready(creation_id, attempts=3)
        result = client.publish(creation_id)

        self.assertEqual("media-1", result.media_id)
        self.assertEqual("https://www.instagram.com/reel/shortcode/", result.url)
        self.assertEqual(
            [
                ("POST", "/1784/media"),
                ("GET", "/container-1"),
                ("GET", "/container-1"),
                ("POST", "/1784/media_publish"),
                ("GET", "/media-1"),
            ],
            [(method, path) for method, path, _ in transport.calls],
        )
        self.assertEqual("REELS", transport.calls[0][2]["media_type"])

    def test_error_container_is_terminal(self):
        client = InstagramClient(
            "1784", RecordingTransport([{"status_code": "ERROR"}]), poll_seconds=0
        )
        with self.assertRaises(InstagramApiError) as caught:
            client.wait_until_ready("container-1", attempts=1)
        self.assertFalse(caught.exception.retryable)

    def test_timeout_is_retryable(self):
        client = InstagramClient(
            "1784", RecordingTransport([{"status_code": "IN_PROGRESS"}]), poll_seconds=0
        )
        with self.assertRaises(InstagramApiError) as caught:
            client.wait_until_ready("container-1", attempts=1)
        self.assertTrue(caught.exception.retryable)

    def test_api_error_never_contains_access_token(self):
        error = InstagramApiError("request failed", retryable=True)
        self.assertNotIn("secret-token", str(error))


if __name__ == "__main__":
    unittest.main()
