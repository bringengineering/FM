import csv
import tempfile
import unittest
from pathlib import Path

from automation.bringcare_learning.schema import (
    PERFORMANCE_COLUMNS,
    append_unique_row,
    parse_optional_int,
    validate_performance_row,
)


class LearningSchemaTests(unittest.TestCase):
    def test_performance_contract_contains_four_snapshots(self):
        for suffix in ("72h", "7d", "14d", "30d"):
            self.assertIn(f"views_{suffix}", PERFORMANCE_COLUMNS)
            self.assertIn(f"search_traffic_{suffix}", PERFORMANCE_COLUMNS)
            self.assertIn(f"consultations_{suffix}", PERFORMANCE_COLUMNS)

    def test_missing_metric_is_na_not_zero(self):
        self.assertIsNone(parse_optional_int("NA"))
        self.assertEqual(0, parse_optional_int("0"))

    def test_duplicate_post_id_is_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "performance.csv"
            row = {column: "NA" for column in PERFORMANCE_COLUMNS}
            row.update({"post_id": "20260817-test", "title": "테스트"})
            append_unique_row(path, PERFORMANCE_COLUMNS, row, "post_id")
            with self.assertRaisesRegex(ValueError, "duplicate post_id"):
                append_unique_row(path, PERFORMANCE_COLUMNS, row, "post_id")

    def test_future_snapshot_is_rejected(self):
        row = {column: "NA" for column in PERFORMANCE_COLUMNS}
        row.update(
            {
                "post_id": "20260817-test",
                "title": "테스트",
                "published_at": "2026-08-17T12:00:00+09:00",
                "collected_at_30d": "2026-08-18T12:00:00+09:00",
                "views_30d": "100",
            }
        )
        errors = validate_performance_row(
            row, now_iso="2026-08-18T12:00:00+09:00"
        )
        self.assertIn("30d snapshot collected before due time", errors)


if __name__ == "__main__":
    unittest.main()
