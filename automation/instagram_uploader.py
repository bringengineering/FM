from __future__ import annotations

import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Mapping, Protocol


GRAPH_API_BASE = "https://graph.facebook.com/v26.0"


class InstagramConfigurationError(RuntimeError):
    pass


class InstagramApiError(RuntimeError):
    def __init__(self, message: str, *, retryable: bool, code: int | None = None):
        super().__init__(message)
        self.retryable = retryable
        self.code = code


def _windows_user_environment() -> dict[str, str]:
    if os.name != "nt":
        return {}
    try:
        import winreg

        values: dict[str, str] = {}
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, "Environment") as key:
            for name in (
                "META_PAGE_ACCESS_TOKEN",
                "INSTAGRAM_BUSINESS_ACCOUNT_ID",
            ):
                try:
                    values[name] = str(winreg.QueryValueEx(key, name)[0])
                except FileNotFoundError:
                    continue
        return values
    except OSError:
        return {}


@dataclass(frozen=True)
class InstagramConfig:
    access_token: str
    instagram_account_id: str

    @classmethod
    def from_env(cls, env: Mapping[str, str] | None = None) -> "InstagramConfig":
        source = (
            {**_windows_user_environment(), **os.environ}
            if env is None
            else dict(env)
        )
        missing = [
            key
            for key in ("META_PAGE_ACCESS_TOKEN", "INSTAGRAM_BUSINESS_ACCOUNT_ID")
            if not source.get(key)
        ]
        if missing:
            raise InstagramConfigurationError(
                "Missing required environment variables: " + ", ".join(missing)
            )
        return cls(
            access_token=source["META_PAGE_ACCESS_TOKEN"],
            instagram_account_id=source["INSTAGRAM_BUSINESS_ACCOUNT_ID"],
        )


@dataclass(frozen=True)
class InstagramPublishResult:
    media_id: str
    url: str


class GraphTransport(Protocol):
    def request(
        self, method: str, path: str, *, params: Mapping[str, str] | None = None
    ) -> dict: ...


class UrllibGraphTransport:
    def __init__(
        self,
        access_token: str,
        *,
        base_url: str = GRAPH_API_BASE,
        opener=None,
    ):
        self._access_token = access_token
        self._base_url = base_url.rstrip("/")
        self._opener = opener or urllib.request.urlopen

    def request(
        self, method: str, path: str, *, params: Mapping[str, str] | None = None
    ) -> dict:
        payload = urllib.parse.urlencode(params or {}).encode("utf-8")
        url = self._base_url + path
        if method == "GET" and payload:
            url += "?" + payload.decode("utf-8")
            payload = None
        request = urllib.request.Request(
            url,
            data=payload if method == "POST" else None,
            method=method,
            headers={"Authorization": f"Bearer {self._access_token}"},
        )
        try:
            with self._opener(request, timeout=30) as response:
                return json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            status = exc.code
            try:
                body = json.loads(exc.read().decode("utf-8"))
                graph_error = body.get("error", {})
                code = graph_error.get("code")
                message = graph_error.get("message", "Graph API request failed")
            except (ValueError, UnicodeDecodeError):
                code = None
                message = "Graph API request failed"
            retryable = status == 429 or status >= 500
            raise InstagramApiError(
                f"Graph API error ({status}): {message}",
                retryable=retryable,
                code=code,
            ) from None
        except urllib.error.URLError:
            raise InstagramApiError(
                "Graph API network request failed", retryable=True
            ) from None

    def upload_file(self, upload_uri: str, video_path: Path) -> dict:
        parsed = urllib.parse.urlparse(upload_uri)
        if parsed.scheme != "https":
            raise InstagramApiError(
                "Instagram upload URI must use HTTPS", retryable=False
            )
        size = video_path.stat().st_size
        request = urllib.request.Request(
            upload_uri,
            data=video_path.read_bytes(),
            method="POST",
            headers={
                "Authorization": f"OAuth {self._access_token}",
                "offset": "0",
                "file_size": str(size),
            },
        )
        try:
            with self._opener(request, timeout=120) as response:
                return json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            status = exc.code
            try:
                body = json.loads(exc.read().decode("utf-8"))
                graph_error = body.get("error", {})
                code = graph_error.get("code")
                message = graph_error.get("message", "Instagram upload failed")
            except (ValueError, UnicodeDecodeError):
                code = None
                message = "Instagram upload failed"
            raise InstagramApiError(
                f"Graph API error ({status}): {message}",
                retryable=status == 429 or status >= 500,
                code=code,
            ) from None
        except urllib.error.URLError:
            raise InstagramApiError(
                "Instagram upload network request failed", retryable=True
            ) from None


class InstagramClient:
    def __init__(
        self,
        instagram_account_id: str,
        transport: GraphTransport,
        *,
        poll_seconds: float = 3.0,
    ):
        self.instagram_account_id = instagram_account_id
        self.transport = transport
        self.poll_seconds = poll_seconds

    @classmethod
    def from_config(cls, config: InstagramConfig) -> "InstagramClient":
        return cls(
            config.instagram_account_id,
            UrllibGraphTransport(config.access_token),
        )

    def create_reel(self, *, video_url: str, caption: str) -> str:
        response = self.transport.request(
            "POST",
            f"/{self.instagram_account_id}/media",
            params={
                "media_type": "REELS",
                "video_url": video_url,
                "caption": caption,
            },
        )
        creation_id = response.get("id")
        if not creation_id:
            raise InstagramApiError(
                "Instagram did not return a creation id", retryable=False
            )
        return str(creation_id)

    def container_status(self, creation_id: str) -> str:
        response = self.transport.request(
            "GET", f"/{creation_id}", params={"fields": "status_code"}
        )
        return str(response.get("status_code", "UNKNOWN"))

    def wait_until_ready(self, creation_id: str, *, attempts: int = 20) -> None:
        for attempt in range(attempts):
            status = self.container_status(creation_id)
            if status == "FINISHED":
                return
            if status in {"ERROR", "EXPIRED"}:
                raise InstagramApiError(
                    f"Instagram media container ended with {status}", retryable=False
                )
            if attempt + 1 < attempts:
                time.sleep(self.poll_seconds)
        raise InstagramApiError(
            "Instagram media container is still processing", retryable=True
        )

    def publish(self, creation_id: str) -> InstagramPublishResult:
        response = self.transport.request(
            "POST",
            f"/{self.instagram_account_id}/media_publish",
            params={"creation_id": creation_id},
        )
        media_id = response.get("id")
        if not media_id:
            raise InstagramApiError(
                "Instagram did not return a media id", retryable=False
            )
        details = self.transport.request(
            "GET", f"/{media_id}", params={"fields": "permalink"}
        )
        permalink = details.get("permalink")
        if not permalink:
            raise InstagramApiError(
                "Instagram did not return a permalink", retryable=True
            )
        return InstagramPublishResult(media_id=str(media_id), url=str(permalink))


def publish_reel(*, video_url: str, caption: str) -> InstagramPublishResult:
    client = InstagramClient.from_config(InstagramConfig.from_env())
    creation_id = client.create_reel(video_url=video_url, caption=caption)
    client.wait_until_ready(creation_id)
    return client.publish(creation_id)
