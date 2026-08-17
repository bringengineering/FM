# Card Threshold Explainer Production Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce a complete 94-second, 12-scene Korean faceless explainer package for `카드 실적이 3만 원 남았을 때`, including two Gemini video prompts per scene.

**Architecture:** Store the production package in one human-readable Markdown file and validate its structured requirements with a focused Python test. Lock the shared 3D machine style first, then build the timed narration matrix, create stable and multishot prompts, and finish with continuity and factual QA before any Gemini generation.

**Tech Stack:** Markdown, Python 3, pytest, Gemini video generation, CapCut or equivalent editor

---

## File Structure

- Create: `production/card_threshold_remake_02.md` — final narration, 12-scene storyboard, 24 Gemini prompts, captions, sound and editing instructions.
- Create: `automation/tests/test_card_threshold_remake_02.py` — validates scene count, prompt count, money consistency, required disclosures and banned visual terms.
- Reference: `docs/superpowers/specs/2026-08-16-card-threshold-video-redesign.md` — approved design source of truth.
- Reference: `research/youtube_shorts/2026-08-15/card_rewards_factpack.md` — evidence and claim boundaries.

### Task 1: Create the production package skeleton

**Files:**
- Create: `production/card_threshold_remake_02.md`
- Create: `automation/tests/test_card_threshold_remake_02.py`

- [ ] **Step 1: Write the failing structure test**

```python
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[2]
PACKAGE = ROOT / "production" / "card_threshold_remake_02.md"


def package_text():
    return PACKAGE.read_text(encoding="utf-8")


def test_has_exactly_12_scenes_and_24_prompts():
    text = package_text()
    assert len(re.findall(r"^## SCENE \\d{2}", text, re.M)) == 12
    assert len(re.findall(r"^### Gemini Prompt [AB]$", text, re.M)) == 24
```

- [ ] **Step 2: Run the structure test to verify it fails**

Run: `py -m pytest automation/tests/test_card_threshold_remake_02.py::test_has_exactly_12_scenes_and_24_prompts -v`

Expected: FAIL because `production/card_threshold_remake_02.md` does not exist.

- [ ] **Step 3: Create the package headings**

Create `production/card_threshold_remake_02.md` with these top-level sections:

```markdown
# 카드 실적 3만 원 — 리메이크 02

## Production Lock
## Master Gemini Style Prompt
## Global Negative Prompt
## SCENE 01
## SCENE 02
## SCENE 03
## SCENE 04
## SCENE 05
## SCENE 06
## SCENE 07
## SCENE 08
## SCENE 09
## SCENE 10
## SCENE 11
## SCENE 12
## Editing Map
## Source and Claim Notes
## Pre-Publish Checklist
```

Under every scene, add these exact subheadings:

```markdown
### Time and Purpose
### Narration
### Editor Caption
### Visual Continuity
### Gemini Prompt A
### Gemini Prompt B
### Sound and Cut
```

- [ ] **Step 4: Run the structure test**

Run: `py -m pytest automation/tests/test_card_threshold_remake_02.py::test_has_exactly_12_scenes_and_24_prompts -v`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add -- production/card_threshold_remake_02.md automation/tests/test_card_threshold_remake_02.py
git commit -m "test: define card threshold production package structure"
```

If Git identity is still unavailable, record the failure and continue without changing global Git configuration.

### Task 2: Lock money facts, narration and timing

**Files:**
- Modify: `production/card_threshold_remake_02.md`
- Modify: `automation/tests/test_card_threshold_remake_02.py`

- [ ] **Step 1: Add the failing content tests**

```python
def test_money_terms_are_consistent():
    text = package_text()
    assert "27만 원" in text
    assert "30만 원" in text
    assert "3만 원" in text
    assert "2만 원" in text
    assert "혜택은 2만 원이고, 새로 나간 돈은 3만 원" in text


def test_research_scope_and_non_generalization_are_present():
    text = package_text()
    assert "미국 금융기관 계좌" in text
    assert "모든 한국 소비자에게 그대로 적용할 수는 없습니다" in text


def test_timing_targets_94_seconds():
    text = package_text()
    ranges = re.findall(r"TIME: (\\d+)–(\\d+)초", text)
    assert len(ranges) == 12
    assert ranges[0] == ("0", "5")
    assert ranges[-1] == ("87", "94")
    assert all(int(ranges[i][1]) == int(ranges[i + 1][0]) for i in range(11))
```

- [ ] **Step 2: Run the content tests to verify they fail**

Run: `py -m pytest automation/tests/test_card_threshold_remake_02.py -v`

Expected: three new tests FAIL because narration and time ranges are absent.

- [ ] **Step 3: Add final scene timing and narration**

Use these exact scene ranges:

```text
01 0–5, 02 5–12, 03 12–19, 04 19–27,
05 27–34, 06 34–47, 07 47–54, 08 54–63,
09 63–72, 10 72–80, 11 80–87, 12 87–94
```

Distribute the approved narration from the design document without changing the four money values. Scene 06 must contain the US research scope and non-generalization sentence. Scene 07 must explicitly reject `카드 실적은 무조건 포기해야 한다`.

- [ ] **Step 4: Run all package tests**

Run: `py -m pytest automation/tests/test_card_threshold_remake_02.py -v`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add -- production/card_threshold_remake_02.md automation/tests/test_card_threshold_remake_02.py
git commit -m "feat: lock card threshold narration and timing"
```

### Task 3: Define the master 3D visual system

**Files:**
- Modify: `production/card_threshold_remake_02.md`
- Modify: `automation/tests/test_card_threshold_remake_02.py`

- [ ] **Step 1: Add the failing visual-safety test**

```python
def test_visual_lock_and_banned_elements():
    text = package_text().lower()
    for required in [
        "vertical 9:16", "matte gray concrete", "brushed metal",
        "blue-gray planned spending blocks", "orange unplanned spending block",
        "small green benefit token", "red measurement lines"
    ]:
        assert required in text
    for banned in ["visible person", "human hand", "smartphone screen", "bank logo"]:
        assert banned in text
```

- [ ] **Step 2: Run the visual-safety test to verify it fails**

Run: `py -m pytest automation/tests/test_card_threshold_remake_02.py::test_visual_lock_and_banned_elements -v`

Expected: FAIL because the master and negative prompts are incomplete.

- [ ] **Step 3: Add the master prompt and global negative prompt**

The master prompt must define one continuous industrial-scale card-threshold machine, simplified educational 3D, neutral daylight, restrained materials, and a consistent left-to-right camera path. The global negative prompt must explicitly prohibit visible people, hands, smartphones, real UI, logos, generated Korean text, neon sci-fi holograms, floating abstract coins, excessive detail and random camera direction changes.

- [ ] **Step 4: Run all package tests**

Run: `py -m pytest automation/tests/test_card_threshold_remake_02.py -v`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add -- production/card_threshold_remake_02.md automation/tests/test_card_threshold_remake_02.py
git commit -m "feat: lock card threshold visual language"
```

### Task 4: Write 24 Gemini scene prompts

**Files:**
- Modify: `production/card_threshold_remake_02.md`
- Modify: `automation/tests/test_card_threshold_remake_02.py`

- [ ] **Step 1: Add the failing prompt-completeness test**

```python
def test_every_prompt_has_format_camera_action_and_continuity():
    text = package_text()
    prompts = re.findall(
        r"^### Gemini Prompt [AB]$\\n+```text\\n(.*?)\\n```",
        text,
        re.M | re.S,
    )
    assert len(prompts) == 24
    for prompt in prompts:
        low = prompt.lower()
        assert "vertical 9:16" in low
        assert "camera" in low
        assert "begin" in low or "starts" in low
        assert "end" in low or "ends" in low
        assert len(prompt) >= 550
```

- [ ] **Step 2: Run the prompt-completeness test to verify it fails**

Run: `py -m pytest automation/tests/test_card_threshold_remake_02.py::test_every_prompt_has_format_camera_action_and_continuity -v`

Expected: FAIL because scene prompts are empty.

- [ ] **Step 3: Write Prompt A for all 12 scenes**

Each A prompt must contain:

```text
format → inherited machine environment → exact starting object → one physical action
→ one camera move → exact ending frame → clear empty subtitle zone → global exclusions
```

Prompt A uses one explanatory action only and prioritizes generation stability.

- [ ] **Step 4: Write Prompt B for all 12 scenes**

Each B prompt must use exactly two beats:

```text
Beat 1: 0–4 seconds, establish the mechanism.
Beat 2: 4–8 seconds, push in or reveal the consequence.
```

Do not introduce a new environment during Beat 2. The second beat must reveal a part of the same machine.

- [ ] **Step 5: Run all package tests**

Run: `py -m pytest automation/tests/test_card_threshold_remake_02.py -v`

Expected: PASS with 24 complete prompts.

- [ ] **Step 6: Commit**

```powershell
git add -- production/card_threshold_remake_02.md automation/tests/test_card_threshold_remake_02.py
git commit -m "feat: add 24 Gemini prompts for card threshold explainer"
```

### Task 5: Add editing map and perform final QA

**Files:**
- Modify: `production/card_threshold_remake_02.md`
- Modify: `automation/tests/test_card_threshold_remake_02.py`

- [ ] **Step 1: Add the failing final-QA test**

```python
def test_editorial_package_is_complete():
    text = package_text()
    assert len(re.findall(r"^CAPTION:", text, re.M)) == 12
    assert len(re.findall(r"^SOUND:", text, re.M)) == 12
    assert "추가지출 > 확정혜택" in text
    assert "상품 없이도 실행 가능" in text
    assert "대표 승인 전 업로드 금지" in text
```

- [ ] **Step 2: Run the final-QA test to verify it fails**

Run: `py -m pytest automation/tests/test_card_threshold_remake_02.py::test_editorial_package_is_complete -v`

Expected: FAIL because caption, sound and approval markers are not complete.

- [ ] **Step 3: Add captions, sound and cut instructions**

Use no more than one editor caption per scene. Reserve numerical captions for `27만 원`, `30만 원`, `3만 원 추가`, `2만 원 혜택`, the US research scope, and the final decision rule. Sound cues should support physical actions: block impact, gate latch, token drop, comparison scale, route switch and quiet release.

- [ ] **Step 4: Add the pre-publish checklist**

The checklist must verify factual scope, money consistency, no brands, no generated Korean text, non-purchase solution first, affiliate disclosure if used, and explicit owner approval before YouTube upload.

- [ ] **Step 5: Run all tests and inspect the document**

Run:

```powershell
py -m pytest automation/tests/test_card_threshold_remake_02.py -v
rg -n "visible person|human hand|smartphone screen|bank logo" production/card_threshold_remake_02.md
```

Expected: all tests PASS; `rg` finds banned terms only inside the Global Negative Prompt.

- [ ] **Step 6: Generate only Scene 01 A/B in Gemini**

Use the master prompt plus Scene 01 Prompt A for one render and the master prompt plus Scene 01 Prompt B for a second render. Do not generate Scenes 02–12 until the user approves one of the two style tests.

- [ ] **Step 7: Commit**

```powershell
git add -- production/card_threshold_remake_02.md automation/tests/test_card_threshold_remake_02.py
git commit -m "docs: finalize card threshold production package"
```
