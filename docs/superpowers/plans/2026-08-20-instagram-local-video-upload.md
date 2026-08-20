# Instagram Local Video Upload Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upload an approved local MP4 directly to Instagram Reels through Meta's resumable upload endpoint without temporary public hosting.

**Architecture:** Extend the existing Graph transport with a binary-file upload operation, then add resumable-container methods to `InstagramClient`. Keep URL publishing backward compatible and let `dual_publisher` select URL or local-file mode from the manifest while preserving platform-level idempotency.

**Tech Stack:** Python 3, `urllib.request`, Meta Graph API v26.0, `unittest`, existing SHA-256 publish state.

---

## File map

- Modify `automation/instagram_uploader.py`: validate local MP4s, create resumable containers, and stream file bytes to Meta.
- Modify `automation/tests/test_instagram_uploader.py`: transport, validation, upload, and token-redaction tests.
- Modify `automation/dual_publisher.py`: accept `video_path` or `video_url` and route to the matching client flow.
- Modify `automation/tests/test_dual_publisher.py`: local-path mapping and URL compatibility tests.
- Modify `docs/INSTAGRAM_DUAL_PUBLISH_RUNBOOK.md`: document local upload and the one-post live verification gate.
- Create `output/united_breaks_guitars_01/dual_publish_manifest.json`: approved test package metadata, with approval left false until the final user confirmation.

### Task 1: Binary upload transport

**Files:**
- Modify: `automation/tests/test_instagram_uploader.py`
- Modify: `automation/instagram_uploader.py`

- [ ] **Step 1: Write the failing binary-upload transport test**

Add a fake opener and assert that the upload request uses the returned HTTPS URI, the MP4 body, and only the required headers:

```python
def test_upload_file_sends_binary_with_resumable_headers(self):
    video = self.root / "video.mp4"
    video.write_bytes(b"mp4-bytes")
    transport = UrllibGraphTransport("secret-token", opener=self.opener)
    result = transport.upload_file(
        "https://rupload.facebook.com/ig-api-upload/v26.0/container-1",
        video,
    )
    self.assertEqual({"success": True}, result)
    request = self.opener.requests[0]
    self.assertEqual(b"mp4-bytes", request.data)
    self.assertEqual("OAuth secret-token", request.headers["Authorization"])
    self.assertEqual("0", request.headers["Offset"])
    self.assertEqual("9", request.headers["File_size"])
```

- [ ] **Step 2: Run the test and verify RED**

Run: `python -m pytest -q automation/tests/test_instagram_uploader.py::InstagramTransportTests::test_upload_file_sends_binary_with_resumable_headers`

Expected: FAIL because `UrllibGraphTransport` has no `upload_file` operation or injectable opener.

- [ ] **Step 3: Implement the minimal transport operation**

Add an optional opener and a binary uploader that rejects non-HTTPS endpoints before reading the file:

```python
class UrllibGraphTransport:
    def __init__(self, access_token, *, base_url=GRAPH_API_BASE, opener=None):
        self._access_token = access_token
        self._base_url = base_url.rstrip("/")
        self._opener = opener or urllib.request.urlopen

    def upload_file(self, upload_uri: str, video_path: Path) -> dict:
        parsed = urllib.parse.urlparse(upload_uri)
        if parsed.scheme != "https":
            raise InstagramApiError("Instagram upload URI must use HTTPS", retryable=False)
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
        with self._opener(request, timeout=120) as response:
            return json.loads(response.read().decode("utf-8"))
```

Use the same sanitized `InstagramApiError` mapping as Graph requests for HTTP, network, 429, and 5xx failures.

- [ ] **Step 4: Run the transport tests and verify GREEN**

Run: `python -m pytest -q automation/tests/test_instagram_uploader.py`

Expected: all Instagram uploader tests pass.

- [ ] **Step 5: Commit**

```powershell
git add automation/instagram_uploader.py automation/tests/test_instagram_uploader.py
git commit -m "feat: add Instagram resumable binary transport"
```

### Task 2: Resumable Reel client flow

**Files:**
- Modify: `automation/tests/test_instagram_uploader.py`
- Modify: `automation/instagram_uploader.py`

- [ ] **Step 1: Write failing client and validation tests**

```python
def test_create_and_upload_local_reel(self):
    video = self.root / "video.mp4"
    video.write_bytes(b"video")
    transport = RecordingTransport([
        {"id": "container-1", "uri": "https://rupload.facebook.com/u/container-1"},
        {"success": True},
    ])
    client = InstagramClient("1784", transport, poll_seconds=0)
    creation_id, upload_uri = client.create_resumable_reel(caption="caption")
    client.upload_local_video(upload_uri, video)
    self.assertEqual("resumable", transport.calls[0][2]["upload_type"])
    self.assertEqual(video, transport.uploads[0][1])

def test_local_video_requires_nonempty_mp4(self):
    for name in ("empty.mp4", "video.mov"):
        path = self.root / name
        path.write_bytes(b"")
        with self.assertRaises(InstagramConfigurationError):
            validate_local_video(path)
```

- [ ] **Step 2: Run the tests and verify RED**

Run: `python -m pytest -q automation/tests/test_instagram_uploader.py -k "local or resumable"`

Expected: FAIL because the local-video API does not exist.

- [ ] **Step 3: Implement the minimal resumable client API**

```python
def validate_local_video(path: Path) -> Path:
    resolved = path.expanduser().resolve()
    if not resolved.is_file() or resolved.suffix.lower() != ".mp4":
        raise InstagramConfigurationError("Instagram local video must be an MP4 file")
    if resolved.stat().st_size <= 0:
        raise InstagramConfigurationError("Instagram local video is empty")
    return resolved

def create_resumable_reel(self, *, caption: str) -> tuple[str, str]:
    response = self.transport.request("POST", f"/{self.instagram_account_id}/media", params={
        "media_type": "REELS", "upload_type": "resumable", "caption": caption,
    })
    if not response.get("id") or not response.get("uri"):
        raise InstagramApiError("Instagram did not return resumable upload details", retryable=False)
    return str(response["id"]), str(response["uri"])

def upload_local_video(self, upload_uri: str, video_path: Path) -> None:
    response = self.transport.upload_file(upload_uri, validate_local_video(video_path))
    if response.get("success") is not True:
        raise InstagramApiError("Instagram did not accept the video upload", retryable=True)
```

- [ ] **Step 4: Run the uploader suite and verify GREEN**

Run: `python -m pytest -q automation/tests/test_instagram_uploader.py`

Expected: all tests pass and no token appears in captured errors.

- [ ] **Step 5: Commit**

```powershell
git add automation/instagram_uploader.py automation/tests/test_instagram_uploader.py
git commit -m "feat: upload local MP4 to Instagram Reels"
```

### Task 3: Dual-publisher manifest routing

**Files:**
- Modify: `automation/tests/test_dual_publisher.py`
- Modify: `automation/dual_publisher.py`

- [ ] **Step 1: Write failing local-path and compatibility tests**

```python
def test_manifest_accepts_local_instagram_video(self):
    manifest = valid_manifest(self.root)
    manifest["instagram"].pop("video_url")
    manifest["instagram"]["video_path"] = manifest["video"]
    self.assertEqual(Path(manifest["video"]), validate_publish_manifest(manifest))

def test_instagram_publisher_uses_local_upload_when_path_is_present(self):
    job = valid_manifest(self.root)
    job["instagram"] = {"caption": "caption", "video_path": job["video"]}
    result = make_instagram_publisher(self.client)(job)
    self.assertEqual(Path(job["video"]), self.client.local_video)
    self.assertEqual("ig1", result["id"])
```

Keep the existing `test_instagram_publisher_maps_client_result` unchanged to prove the URL path still works.

- [ ] **Step 2: Run the tests and verify RED**

Run: `python -m pytest -q automation/tests/test_dual_publisher.py -k "instagram or manifest"`

Expected: FAIL because validation still requires `video_url` and the publisher always calls `create_reel`.

- [ ] **Step 3: Implement deterministic source selection**

```python
if instagram.get("video_url") and instagram.get("video_path"):
    raise PublishBlocked("Instagram accepts only one explicit video source")
if not instagram.get("caption"):
    raise PublishBlocked("Instagram requires one video source and a caption")
video_source = instagram.get("video_url") or instagram.get("video_path") or manifest.get("video")
if not video_source:
    raise PublishBlocked("Instagram video source is required")
```

In `make_instagram_publisher`, use local mode when `video_path` is explicitly present; otherwise preserve URL mode. Local mode calls `create_resumable_reel`, `upload_local_video`, `wait_until_ready`, and `publish` exactly once each.

- [ ] **Step 4: Run both publisher suites and verify GREEN**

Run: `python -m pytest -q automation/tests/test_dual_publisher.py automation/tests/test_instagram_uploader.py`

Expected: all tests pass.

- [ ] **Step 5: Commit**

```powershell
git add automation/dual_publisher.py automation/tests/test_dual_publisher.py
git commit -m "feat: route local videos through Instagram publisher"
```

### Task 4: Runbook and approved test package

**Files:**
- Modify: `docs/INSTAGRAM_DUAL_PUBLISH_RUNBOOK.md`
- Create: `output/united_breaks_guitars_01/dual_publish_manifest.json`

- [ ] **Step 1: Add the local manifest example to the runbook**

Document `instagram.video_path`, the fallback to top-level `video`, the public-confirmation gate, and that `video_url` and `video_path` must not be supplied together.

- [ ] **Step 2: Create the live-test manifest with publishing disabled**

```json
{
  "video": "C:/Users/user/OneDrive - 상지대학교/문서/ChatGPT/마케팅/output/united_breaks_guitars_01/united_breaks_guitars_final.mp4",
  "target": "both",
  "approval": {"approved": false, "approved_at": null, "approved_by": null},
  "qc": {"required_gates": ["audio", "captions", "aspect"], "audio": true, "captions": true, "aspect": true},
  "youtube": {
    "title": "수리비 1,200달러를 거절한 항공사의 결말 #shorts",
    "description": "항공사가 기타 수리비를 거절하자, 음악가는 고객센터 대신 노래를 선택했습니다. 9개월 동안 해결되지 않던 불만은 일주일 만에 약 300만 명이 듣는 이야기가 됐습니다.\n\n여러분이라면 뒤늦은 사과를 받고 영상을 내리시겠습니까?\n\n주요 출처: Harvard Business School, ABC News, The Guardian, Dave Carroll의 원본 영상 설명. 인터넷에 퍼진 ‘주가 1억8천만 달러 손실’은 직접적인 인과관계가 확인되지 않아 사실로 사용하지 않았습니다.\n\n이 영상은 자체 대본·검증·편집과 AI 보조 일러스트레이션 및 합성 음성을 사용해 제작했습니다.",
    "tags": ["유나이티드항공", "UnitedBreaksGuitars", "기업실화", "고객서비스", "브랜드위기", "마케팅", "쇼츠"],
    "privacy_status": "public"
  },
  "instagram": {
    "caption": "항공사가 기타 수리비를 거절하자 고객은 노래로 답했습니다. 여러분이라면 뒤늦은 사과를 받고 영상을 내리시겠습니까? #기업실화 #고객서비스 #브랜드위기",
    "video_path": "C:/Users/user/OneDrive - 상지대학교/문서/ChatGPT/마케팅/output/united_breaks_guitars_01/united_breaks_guitars_final.mp4"
  }
}
```

Use the exact YouTube description and tags shown above, copied from the validated `upload_manifest.json`.

- [ ] **Step 3: Verify that the disabled package is blocked**

Run: `python -m automation.dual_publisher output/united_breaks_guitars_01/dual_publish_manifest.json --dry-run`

Expected: non-zero exit with `Explicit publish approval is required`; no network call and no state file.

- [ ] **Step 4: Run the tracked test suite**

Run:

```powershell
$trackedTests = @(git ls-files 'tests/test_*.py' 'automation/tests/test_*.py')
python -m pytest -q @trackedTests
```

Expected: all tracked tests pass.

- [ ] **Step 5: Commit documentation only**

The output manifest is an operational artifact and remains uncommitted. Commit the runbook:

```powershell
git add docs/INSTAGRAM_DUAL_PUBLISH_RUNBOOK.md
git commit -m "docs: add local Instagram upload runbook"
```

### Task 5: One-post live verification

**Files:**
- Runtime state: `automation/state/publish/<video-sha256>.json`
- Operational input: `output/united_breaks_guitars_01/dual_publish_manifest.json`

- [ ] **Step 1: Present the exact public payload to the user**

Show the video filename, YouTube title, complete YouTube description, Instagram caption, and target `both`. Do not change approval yet.

- [ ] **Step 2: Obtain action-time confirmation**

Require an explicit confirmation that this exact video may be published publicly to both YouTube and Instagram. If confirmation is absent, stop.

- [ ] **Step 3: Record the approval and run one public publish**

Set `approval.approved=true`, record the current ISO-8601 time and `approved_by=user`, then run:

```powershell
python -m automation.dual_publisher output/united_breaks_guitars_01/dual_publish_manifest.json --approve-public
```

Expected: one YouTube URL and one Instagram permalink are recorded as `published` under the same video fingerprint.

- [ ] **Step 4: Verify idempotency without republishing**

Re-run the command with publishers replaced by test doubles or inspect the saved state directly. Confirm both platforms are already `published`; do not make a second live request.

- [ ] **Step 5: Report URLs and state evidence**

Return the two public links, the video fingerprint prefix, attempts per platform, and any platform-specific error. Never print credentials.
