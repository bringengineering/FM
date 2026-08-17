# 마트 카트 생활 미스터리 파일럿 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 수진이 우유 하나를 사러 마트에 갔다가 138,240원을 결제하는 110~120초 세로형 쇼츠를 고정 졸라맨, 2.5D 도식, Veo 특수효과 8~12초, Typecast 음성, 한 줄 자막으로 완성한다.

**Architecture:** 사실 근거와 대본을 구조화된 JSON으로 잠근 뒤, 결정론적 로컬 렌더러가 수진·마트·가격 도식을 생성한다. Veo 클립은 별도 어댑터를 통해 최대 두 개만 생성하며, 비용 가드와 로컬 대체 장면을 둔다. 최종 조립기는 Typecast 단어 타임스탬프에서 한 줄 자막을 만들고 FFmpeg로 음량 정규화된 1080x1920 MP4를 출력한다.

**Tech Stack:** Python 3.11, Pillow, imageio, NumPy, FFmpeg, Google Gen AI SDK(Vertex AI), Typecast API, unittest

---

## File Structure

- Create: `production/mart_cart_pilot/factpack.md` — 검증된 주장과 출처 및 사용 제한
- Create: `production/mart_cart_pilot/story.json` — 장면, 내레이션, 시각 연출, 자막 구문
- Create: `production/mart_cart_pilot/veo_prompts.json` — 두 개의 Veo 프롬프트와 비용 한도
- Create: `automation/mart_pilot/__init__.py` — 패키지 표시
- Create: `automation/mart_pilot/schema.py` — 입력 검증과 비용 계산
- Create: `automation/mart_pilot/render_2d.py` — 수진과 2.5D 마트 장면 렌더
- Create: `automation/mart_pilot/veo.py` — Vertex AI Veo 생성 및 캐시
- Create: `automation/mart_pilot/audio.py` — Typecast 합성 및 단어 타임스탬프
- Create: `automation/mart_pilot/assemble.py` — 영상·음성·자막 최종 조립
- Create: `automation/mart_pilot/run.py` — 파이프라인 CLI
- Create: `tests/test_mart_pilot.py` — 타임라인, 비용, 자막, 캐릭터 잠금 테스트
- Modify: `automation/requirements.txt` — Google Gen AI SDK와 렌더 의존성

### Task 1: 사실 팩과 스토리 잠금

**Files:**
- Create: `production/mart_cart_pilot/factpack.md`
- Create: `production/mart_cart_pilot/story.json`

- [ ] **Step 1: 검증 기준을 factpack에 기록한다**

```markdown
# 마트 소비 행동 사실 팩

## 영상에서 사용할 수 있는 주장
- 할인 프레이밍은 구매 판단에 영향을 줄 수 있다.
- 목록에 없던 상품은 할인되었더라도 총지출을 늘린다. 이는 산술 예시로 설명한다.

## 단정하지 않을 주장
- 모든 마트가 우유를 의도적으로 가장 안쪽에 둔다.
- 큰 카트가 모든 소비자의 구매액을 같은 비율로 증가시킨다.
- 마트가 소비자를 속이기 위해 특정 동선을 사용한다.

## 산술 예시
- 정상가 8,000원, 30% 할인 결제액 5,600원
- 계획에 없던 구매라면 절약 2,400원이 아니라 추가지출 5,600원
```

- [ ] **Step 2: 24개 장면 JSON을 작성한다**

각 장면은 4.5~5.0초이며 다음 스키마를 사용한다.

```json
{
  "slug": "mart_cart_pilot",
  "title": "우유 하나 사러 갔다가 13만 8천 원을 쓴 이유",
  "character": "sujin",
  "duration_target": 116,
  "scenes": [
    {
      "id": 1,
      "duration": 4.8,
      "narration": "오늘 상사에게 영혼까지 털린 수진 씨가 있습니다.",
      "subtitle_chunks": ["오늘 영혼까지 털린", "수진 씨가 있습니다"],
      "visual": "수진이 회사 출입문을 나와 휴대전화를 확인한다",
      "renderer": "local"
    }
  ]
}
```

- [ ] **Step 3: 스토리 자체 검사를 실행한다**

Run: `python -m json.tool production/mart_cart_pilot/story.json > $null`

Expected: exit code `0`.

- [ ] **Step 4: 변경사항을 커밋한다**

```powershell
git add production/mart_cart_pilot/factpack.md production/mart_cart_pilot/story.json
git commit -m "content: lock mart cart pilot story"
```

### Task 2: 스키마와 비용 가드

**Files:**
- Create: `automation/mart_pilot/__init__.py`
- Create: `automation/mart_pilot/schema.py`
- Create: `tests/test_mart_pilot.py`

- [ ] **Step 1: 실패하는 타임라인·비용 테스트를 작성한다**

```python
import unittest
from automation.mart_pilot.schema import veo_cost_usd, validate_story


class MartPilotTests(unittest.TestCase):
    def test_story_duration_is_short(self):
        story = {"character": "sujin", "duration_target": 116,
                 "scenes": [{"id": i, "duration": 4.8, "narration": "x",
                             "subtitle_chunks": ["x"], "visual": "x",
                             "renderer": "local"} for i in range(1, 25)]}
        validate_story(story)

    def test_rejects_more_than_twelve_veo_seconds(self):
        self.assertGreater(veo_cost_usd(16, "lite"), veo_cost_usd(12, "lite"))
        with self.assertRaises(ValueError):
            veo_cost_usd(16, "lite", max_seconds=12)

    def test_lite_cost_for_twelve_seconds(self):
        self.assertEqual(veo_cost_usd(12, "lite"), 0.60)
```

- [ ] **Step 2: 테스트가 실패하는지 확인한다**

Run: `python -m unittest tests.test_mart_pilot -v`

Expected: FAIL because `automation.mart_pilot.schema` does not exist.

- [ ] **Step 3: 최소 스키마 구현을 작성한다**

```python
PRICES = {"lite": 0.05, "fast": 0.10}


def veo_cost_usd(seconds: float, model: str, max_seconds: float = 12) -> float:
    if seconds > max_seconds:
        raise ValueError(f"Veo duration {seconds}s exceeds {max_seconds}s budget")
    return round(seconds * PRICES[model], 2)


def validate_story(story: dict) -> None:
    if story["character"] != "sujin":
        raise ValueError("pilot character must remain sujin")
    total = sum(float(scene["duration"]) for scene in story["scenes"])
    if not 110 <= total <= 120:
        raise ValueError(f"timeline must be 110-120 seconds, got {total}")
    for scene in story["scenes"]:
        if not scene["subtitle_chunks"] or any("\n" in x for x in scene["subtitle_chunks"]):
            raise ValueError(f"scene {scene['id']} subtitle must be one-line chunks")
```

- [ ] **Step 4: 테스트가 통과하는지 확인한다**

Run: `python -m unittest tests.test_mart_pilot -v`

Expected: 3 tests PASS.

- [ ] **Step 5: 커밋한다**

```powershell
git add automation/mart_pilot tests/test_mart_pilot.py
git commit -m "feat: add mart pilot validation and cost guard"
```

### Task 3: 결정론적 졸라맨·마트 렌더러

**Files:**
- Create: `automation/mart_pilot/render_2d.py`
- Modify: `tests/test_mart_pilot.py`

- [ ] **Step 1: 캐릭터 잠금 테스트를 추가한다**

```python
from automation.mart_pilot.render_2d import CHARACTER_LOCK


def test_sujin_character_lock(self):
    self.assertEqual(CHARACTER_LOCK["name"], "sujin")
    self.assertEqual(CHARACTER_LOCK["accent"], "#F4C542")
    self.assertEqual(CHARACTER_LOCK["hair"], "bun")
```

- [ ] **Step 2: 테스트 실패를 확인한다**

Run: `python -m unittest tests.test_mart_pilot.MartPilotTests.test_sujin_character_lock -v`

Expected: FAIL because `render_2d` does not exist.

- [ ] **Step 3: 렌더러의 고정 인터페이스를 구현한다**

```python
CHARACTER_LOCK = {"name": "sujin", "accent": "#F4C542", "hair": "bun"}


def render_scene(scene: dict, output, *, width=720, height=1280, fps=30) -> None:
    """Render one deterministic MP4 scene with no generated text."""
    # Pillow layers: environment, path/price diagrams, sujin, camera crop.
    # Text layers are intentionally excluded and added during final assembly.
```

구현 시 회사, 거리, 마트 입구, 선반, 계산대 레이아웃을 함수별로 나누고 수진은 같은 머리·몸 색상·비율을 사용한다.

- [ ] **Step 4: 1번과 18번 장면의 미리보기를 렌더한다**

Run: `python -m automation.mart_pilot.render_2d --story production/mart_cart_pilot/story.json --scenes 1,18 --preview`

Expected: `production/renders/mart_cart_pilot/previews/scene_01.png` and `scene_18.png` exist and are 720x1280.

- [ ] **Step 5: 테스트를 실행하고 커밋한다**

Run: `python -m unittest tests.test_mart_pilot -v`

Expected: all tests PASS.

```powershell
git add automation/mart_pilot/render_2d.py tests/test_mart_pilot.py
git commit -m "feat: render locked sujin mart scenes"
```

### Task 4: Veo 두 장면 생성 어댑터

**Files:**
- Create: `production/mart_cart_pilot/veo_prompts.json`
- Create: `automation/mart_pilot/veo.py`
- Modify: `automation/requirements.txt`
- Modify: `tests/test_mart_pilot.py`

- [ ] **Step 1: 프롬프트와 예산을 기록한다**

```json
{
  "model": "veo-3.1-lite-generate-001",
  "resolution": "720p",
  "aspect_ratio": "9:16",
  "max_total_seconds": 12,
  "clips": [
    {"id": "mart_dungeon", "duration": 6,
     "prompt": "Vertical 9:16 miniature supermarket diorama transforms into a playful game dungeon, clean geometric shelves, sale signs represented only as blank colored shapes, no people, no letters, no words, stable camera push-in."},
    {"id": "receipt_cutaway", "duration": 6,
     "prompt": "Vertical 9:16 architectural cutaway of a miniature supermarket, products and blank price tokens rise along a glowing shopping path toward checkout, clean educational visualization, no people, no letters, no words."}
  ]
}
```

- [ ] **Step 2: 비용 한도와 캐시 테스트를 추가한다**

```python
from automation.mart_pilot.veo import total_requested_seconds


def test_veo_prompt_budget(self):
    config = {"clips": [{"duration": 6}, {"duration": 6}]}
    self.assertEqual(total_requested_seconds(config), 12)
```

- [ ] **Step 3: Vertex AI 클라이언트를 구현한다**

```python
from google import genai
from google.genai import types


def total_requested_seconds(config: dict) -> int:
    return sum(int(x["duration"]) for x in config["clips"])


def generate_clip(project: str, clip: dict, output) -> None:
    if output.exists() and output.stat().st_size > 100_000:
        return
    client = genai.Client(vertexai=True, project=project, location="us-central1")
    operation = client.models.generate_videos(
        model="veo-3.1-lite-generate-001",
        prompt=clip["prompt"],
        config=types.GenerateVideosConfig(
            aspect_ratio="9:16", resolution="720p", duration_seconds=clip["duration"]
        ),
    )
    # Poll operation, then save exactly one MP4 to output.
```

- [ ] **Step 4: 의존성을 추가한다**

```text
google-genai>=1.40,<2
```

- [ ] **Step 5: 드라이런에서 비용을 확인한다**

Run: `python -m automation.mart_pilot.veo --config production/mart_cart_pilot/veo_prompts.json --dry-run`

Expected: `12 seconds`, `$0.60`, no network generation.

- [ ] **Step 6: 커밋한다**

```powershell
git add production/mart_cart_pilot/veo_prompts.json automation/mart_pilot/veo.py automation/requirements.txt tests/test_mart_pilot.py
git commit -m "feat: add budgeted Veo clips for mart pilot"
```

### Task 5: Typecast 음성과 한 줄 자막

**Files:**
- Create: `automation/mart_pilot/audio.py`
- Modify: `tests/test_mart_pilot.py`

- [ ] **Step 1: 한 줄 자막 분할 테스트를 작성한다**

```python
from automation.mart_pilot.audio import split_caption


def test_caption_is_short_and_single_line(self):
    chunks = split_caption("할인은 가격을 낮추지만 구매 여부까지 바꾸면 지출은 늘어납니다", 18)
    self.assertTrue(all("\n" not in x and len(x) <= 18 for x in chunks))
```

- [ ] **Step 2: 실패를 확인한다**

Run: `python -m unittest tests.test_mart_pilot.MartPilotTests.test_caption_is_short_and_single_line -v`

Expected: FAIL because `audio` does not exist.

- [ ] **Step 3: Typecast와 자막 인터페이스를 구현한다**

```python
def split_caption(text: str, limit: int = 18) -> list[str]:
    words, lines, line = text.split(), [], ""
    for word in words:
        candidate = word if not line else f"{line} {word}"
        if len(candidate) > limit and line:
            lines.append(line)
            line = word
        else:
            line = candidate
    if line:
        lines.append(line)
    return lines
```

Typecast 호출은 기존 `synthesize_scene` 요청 형식을 재사용하되 문장 사이 패딩을 0.15~0.30초로 제한하고 원본 단어 타임스탬프를 JSON으로 저장한다.

- [ ] **Step 4: 테스트와 음성 스모크 테스트를 실행한다**

Run: `python -m unittest tests.test_mart_pilot -v`

Expected: all tests PASS.

Run: `python -m automation.mart_pilot.audio --story production/mart_cart_pilot/story.json --scene 1`

Expected: scene 1 WAV and timestamp JSON exist.

- [ ] **Step 5: 커밋한다**

```powershell
git add automation/mart_pilot/audio.py tests/test_mart_pilot.py
git commit -m "feat: synthesize timed narration and one-line captions"
```

### Task 6: 최종 조립과 품질 검증

**Files:**
- Create: `automation/mart_pilot/assemble.py`
- Create: `automation/mart_pilot/run.py`
- Modify: `tests/test_mart_pilot.py`

- [ ] **Step 1: 최종 출력 계약 테스트를 추가한다**

```python
from automation.mart_pilot.assemble import output_contract


def test_output_contract(self):
    self.assertEqual(output_contract(), {
        "width": 1080, "height": 1920, "fps": 30,
        "audio_lufs": -14, "true_peak": -1.5
    })
```

- [ ] **Step 2: 조립기를 구현한다**

```python
def output_contract() -> dict:
    return {"width": 1080, "height": 1920, "fps": 30,
            "audio_lufs": -14, "true_peak": -1.5}
```

조립기는 24개 장면을 순서대로 연결하고 Veo 두 장면을 지정 위치에 삽입한다. ASS 자막은 한 줄만 표시하고 FFmpeg `loudnorm=I=-14:TP=-1.5:LRA=7`을 적용한다.

- [ ] **Step 3: 드라이런으로 전체 의존성과 비용을 확인한다**

Run: `python -m automation.mart_pilot.run --dry-run`

Expected: story valid, 24 scenes, 110~120 seconds, Veo <=12 seconds, estimated Veo <=$0.60.

- [ ] **Step 4: 로컬 대체 장면으로 무과금 초안을 렌더한다**

Run: `python -m automation.mart_pilot.run --skip-veo`

Expected: `production/renders/mart_cart_pilot/mart_cart_pilot_draft.mp4` exists.

- [ ] **Step 5: Vertex 인증 후 Veo 장면을 한 번만 생성한다**

Run: `python -m automation.mart_pilot.run --generate-veo --max-veo-usd 0.60`

Expected: exactly two cached Veo clips and no regeneration of existing clips.

- [ ] **Step 6: 최종 영상을 렌더하고 검사한다**

Run: `python -m automation.mart_pilot.run --final`

Expected: `production/renders/mart_cart_pilot/mart_cart_pilot_final.mp4` exists.

Run: `ffprobe -v error -show_entries stream=width,height,r_frame_rate -show_entries format=duration -of json production/renders/mart_cart_pilot/mart_cart_pilot_final.mp4`

Expected: 1080x1920, 30fps, duration 110~120 seconds.

- [ ] **Step 7: 전체 테스트를 실행하고 커밋한다**

Run: `python -m unittest tests.test_mart_pilot -v`

Expected: all tests PASS.

```powershell
git add automation/mart_pilot tests/test_mart_pilot.py production/mart_cart_pilot production/renders/mart_cart_pilot/youtube_manifest.json
git commit -m "feat: complete mart cart lifestyle mystery pilot"
```

