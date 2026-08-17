import unittest

from automation.bringcare_learning.feedback import next_run_actions
from automation.bringcare_learning.scoring import choose_candidate


class LearningIntegrationTests(unittest.TestCase):
    def test_performance_collection_precedes_new_topic_selection(self):
        actions = next_run_actions(
            now_iso="2026-08-17T12:00:00+09:00", due_post_ids=["p1"]
        )
        self.assertEqual("collect_performance", actions[0]["type"])

    def test_cooldown_candidate_cannot_win(self):
        candidates = [
            {"id": "cool", "score": 100, "cooldown_active": True},
            {"id": "open", "score": 75, "cooldown_active": False},
        ]
        self.assertEqual("open", choose_candidate(candidates)["id"])

    def test_ai_fallback_never_converts_field_case(self):
        candidate = {
            "post_type": "현장사례",
            "real_photo_available": False,
            "ai_allowed": True,
        }
        self.assertEqual("차단", next_run_actions(candidate=candidate)[0]["status"])

    def test_unknown_metrics_remain_na(self):
        actions = next_run_actions(collected_metrics={"views": None})
        self.assertEqual("NA", actions[0]["row"]["views"])


if __name__ == "__main__":
    unittest.main()
