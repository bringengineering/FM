import unittest

from automation.bringcare_learning.scoring import (
    cooldown_days,
    diagnose_post,
    peer_median,
    score_candidate,
)


class ScoringTests(unittest.TestCase):
    def test_hard_fail_overrides_high_score(self):
        candidate = {
            "current_interest": 20,
            "intent": 20,
            "business_relevance": 20,
            "evidence_and_image": 15,
            "differentiation": 15,
            "historical_performance": 10,
            "fact_safe": False,
            "business_relevant": True,
            "title_body_match": True,
            "privacy_rights_safe": True,
            "self_action_safe": True,
            "field_evidence_ready": True,
        }
        result = score_candidate(candidate)
        self.assertEqual("제외", result.status)
        self.assertIn("fact_safe", result.hard_fails)

    def test_70_points_is_approved(self):
        candidate = {
            "current_interest": 15,
            "intent": 15,
            "business_relevance": 15,
            "evidence_and_image": 10,
            "differentiation": 10,
            "historical_performance": 5,
            "fact_safe": True,
            "business_relevant": True,
            "title_body_match": True,
            "privacy_rights_safe": True,
            "self_action_safe": True,
            "field_evidence_ready": True,
        }
        self.assertEqual("작성승인", score_candidate(candidate).status)

    def test_low_views_with_consultation_is_conversion_win(self):
        labels = diagnose_post(
            {"views": 20, "peer_median_views": 100, "consultations": 1}
        )
        self.assertIn("CONVERSION_WIN", labels)
        self.assertNotIn("TOPIC_WEAK", labels)

    def test_three_topic_weak_results_trigger_60_day_cooldown(self):
        self.assertEqual(60, cooldown_days(["TOPIC_WEAK"] * 3))

    def test_peer_median_requires_20_posts(self):
        self.assertEqual((None, "잠정"), peer_median([10] * 19))

    def test_peer_median_uses_median_after_20_posts(self):
        self.assertEqual((10.5, "확정"), peer_median(list(range(1, 21))))


if __name__ == "__main__":
    unittest.main()
