import unittest

from automation.bringcare_learning.feedback import (
    due_snapshots,
    manual_change_candidate,
)


class FeedbackTests(unittest.TestCase):
    def test_due_snapshots_only_returns_elapsed_uncollected_points(self):
        row = {
            "published_at": "2026-08-01T09:00:00+09:00",
            "collected_at_72h": "2026-08-04T10:00:00+09:00",
            "collected_at_7d": "NA",
            "collected_at_14d": "NA",
            "collected_at_30d": "NA",
        }
        self.assertEqual(
            ["7d", "14d"], due_snapshots(row, "2026-08-17T09:00:00+09:00")
        )

    def test_three_repeated_corrections_create_candidate(self):
        result = manual_change_candidate(
            rule_key="center-alignment",
            evidence_ids=["a", "b", "c"],
            existing_rule="본문 가운데 정렬",
            proposed_rule="발행 후 공개 DOM까지 가운데 정렬 검수",
        )
        self.assertEqual("검토대기", result["approval_status"])

    def test_two_events_do_not_create_candidate(self):
        self.assertIsNone(manual_change_candidate("x", ["a", "b"], "old", "new"))


if __name__ == "__main__":
    unittest.main()
