import unittest
from pathlib import Path

from docx import Document


OUTPUT = Path("manuals/브링케어_네이버블로그_마스터매뉴얼_v1.2.docx")


class ManualV11Tests(unittest.TestCase):
    def test_manual_contains_learning_automation_rules(self):
        self.assertTrue(OUTPUT.exists())
        text = "\n".join(p.text for p in Document(OUTPUT).paragraphs)
        for phrase in (
            "로그인·CAPTCHA·편집기 장애 알림",
            "조건부 AI 이미지 전환",
            "72시간·7일·14일·30일 성과 수집",
            "성과 기반 다음 주제 점수",
            "매뉴얼 개정 후보",
            "공식블로그 100개 표본과 첫 화면 운영",
            "현장 BEFORE → 확인 → 완료",
            "건물주 3분 가이드",
            "퇴실 14일 전",
            "건물의 일을, 한 곳에서 끝냅니다",
        ):
            self.assertIn(phrase, text)


if __name__ == "__main__":
    unittest.main()
