import importlib.util
import sys
import types
import unittest
from pathlib import Path


SKILL = Path(r"C:\Users\user\.codex\skills\writing-bringcare-naver-blog")


def load_script(name):
    if name == "validate_brief" and "yaml" not in sys.modules:
        yaml_stub = types.ModuleType("yaml")
        yaml_stub.safe_load = lambda text: {}
        sys.modules["yaml"] = yaml_stub
    path = SKILL / "scripts" / f"{name}.py"
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class LearningSkillContractTests(unittest.TestCase):
    def test_skill_requires_learning_ledgers_before_topic_selection(self):
        text = (SKILL / "SKILL.md").read_text(encoding="utf-8")
        self.assertIn("performance-ledger.csv", text)
        self.assertIn("topic-cooldown.csv", text)

    def test_format_rules_allow_ai_only_after_real_photo_failure(self):
        text = (SKILL / "references" / "naver-format-qa.md").read_text(
            encoding="utf-8"
        )
        self.assertIn("실사진 확보 실패", text)
        self.assertIn("현장사례에는 AI 이미지를 사용하지 않는다", text)

    def test_keyword_gate_contains_100_point_score(self):
        text = (SKILL / "references" / "keyword-homefeed-gate.md").read_text(
            encoding="utf-8"
        )
        self.assertIn("현재 관심도: 20점", text)
        self.assertIn("과거 유사 콘텐츠 성과: 10점", text)

    def test_ai_image_is_allowed_after_recorded_real_photo_failure(self):
        validator = load_script("validate_brief")
        errors = validator.validate_image_fallback(
            "검색정보",
            [{"kind": "AI"}],
            {
                "real_photo_attempted": True,
                "failure_reason": "대한민국 실사진의 재사용 권리를 확인하지 못함",
                "ai_allowed": True,
                "disclosure_required": True,
            },
        )
        self.assertEqual([], errors)

    def test_ai_image_is_rejected_for_field_case(self):
        validator = load_script("validate_brief")
        errors = validator.validate_image_fallback(
            "현장사례",
            [{"kind": "AI"}],
            {
                "real_photo_attempted": True,
                "failure_reason": "실사진 부족",
                "ai_allowed": True,
                "disclosure_required": True,
            },
        )
        self.assertIn("현장사례에는 AI 이미지를 사용할 수 없습니다", errors)

    def test_draft_requires_ai_disclosure_when_requested(self):
        validator = load_script("validate_draft")
        result = validator.validate_draft(
            "# 가을 환기\n\n설명용 이미지가 들어갑니다.",
            expected_keyword="가을 환기",
            ai_disclosure_required=True,
        )
        self.assertIn("AI 활용 표시가 필요합니다", result["errors"])


if __name__ == "__main__":
    unittest.main()
