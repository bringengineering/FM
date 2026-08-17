import unittest
from pathlib import Path


AUTOMATION = Path(r"C:\Users\user\.codex\automations\automation\automation.toml")


class AutomationPromptTests(unittest.TestCase):
    def test_prompt_contains_learning_and_blocker_contracts(self):
        text = AUTOMATION.read_text(encoding="utf-8")
        for phrase in (
            "performance-ledger.csv",
            "topic-cooldown.csv",
            "72시간·7일·14일·30일",
            "실사진 확보 실패",
            "현장사례에는 AI 이미지를 사용하지 않는다",
            "로그인 만료·CAPTCHA·편집기 구조 변경",
            "동일 장애를 24시간 안에 반복 알림하지 않는다",
        ):
            self.assertIn(phrase, text)


if __name__ == "__main__":
    unittest.main()
