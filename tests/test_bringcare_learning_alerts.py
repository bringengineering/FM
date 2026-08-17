import unittest

from automation.bringcare_learning.alerts import build_alert, should_notify


class AlertTests(unittest.TestCase):
    def test_login_alert_contains_action_and_resume_stage(self):
        message = build_alert(
            blocker="LOGIN_EXPIRED",
            detected_at="2026-08-17T18:00:00+09:00",
            stage="발행시도",
            post_title="가을 냉장고 점검",
        )
        self.assertIn("다시 로그인", message)
        self.assertIn("발행시도", message)
        self.assertIn("가을 냉장고 점검", message)

    def test_same_unresolved_alert_is_suppressed_within_24_hours(self):
        self.assertFalse(
            should_notify(
                last_notified_at="2026-08-17T12:00:00+09:00",
                now_at="2026-08-17T18:00:00+09:00",
                state_changed=False,
            )
        )

    def test_state_change_notifies_immediately(self):
        self.assertTrue(
            should_notify(
                last_notified_at="2026-08-17T12:00:00+09:00",
                now_at="2026-08-17T13:00:00+09:00",
                state_changed=True,
            )
        )


if __name__ == "__main__":
    unittest.main()
