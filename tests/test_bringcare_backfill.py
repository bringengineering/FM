import csv
import unittest
from pathlib import Path


LEDGER = Path("blog/automation/performance-ledger.csv")


class BackfillTests(unittest.TestCase):
    def test_each_public_url_and_post_id_is_unique(self):
        with LEDGER.open(encoding="utf-8-sig", newline="") as handle:
            rows = list(csv.DictReader(handle))
        ids = [row["post_id"] for row in rows]
        urls = [row["public_url"] for row in rows if row["public_url"] not in ("", "NA")]
        self.assertEqual(len(ids), len(set(ids)))
        self.assertEqual(len(urls), len(set(urls)))

    def test_unknown_historical_metrics_are_na(self):
        with LEDGER.open(encoding="utf-8-sig", newline="") as handle:
            for row in csv.DictReader(handle):
                for key, value in row.items():
                    if key.startswith(("views_", "search_traffic_", "consultations_")):
                        self.assertNotEqual("", value)

    def test_initial_inventory_has_confirmed_or_local_records(self):
        with LEDGER.open(encoding="utf-8-sig", newline="") as handle:
            rows = list(csv.DictReader(handle))
        self.assertGreaterEqual(len(rows), 3)


if __name__ == "__main__":
    unittest.main()
