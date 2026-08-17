import csv
from datetime import datetime, timedelta
from pathlib import Path


SNAPSHOTS = {
    "72h": timedelta(hours=72),
    "7d": timedelta(days=7),
    "14d": timedelta(days=14),
    "30d": timedelta(days=30),
}

BASE_COLUMNS = [
    "post_id",
    "title",
    "public_url",
    "published_at",
    "category",
    "post_type",
    "content_role_primary",
    "content_role_secondary",
    "topic_axis",
    "primary_keyword",
    "secondary_keywords",
    "target_reader",
    "reader_scene",
    "promised_answer",
    "cta_type",
    "image_type",
    "headline_pattern",
    "intro_pattern",
    "bringcare_connection_type",
    "affiliate_used",
    "source_count",
]

SNAPSHOT_METRICS = [
    "collected_at",
    "views",
    "search_traffic",
    "homefeed_traffic",
    "external_traffic",
    "top_queries",
    "reactions",
    "comments",
    "saves_or_shares",
    "dwell_metric",
    "consultations",
    "affiliate_actions",
    "data_available",
]

PERFORMANCE_COLUMNS = BASE_COLUMNS + [
    f"{metric}_{suffix}"
    for suffix in SNAPSHOTS
    for metric in SNAPSHOT_METRICS
] + ["result_labels", "diagnosis", "next_action", "confidence"]

EXPERIMENT_COLUMNS = [
    "experiment_id",
    "post_id",
    "hypothesis",
    "primary_variable",
    "control_reference",
    "success_metric",
    "guardrail_metric",
    "sample_requirement",
    "result",
    "decision",
    "confidence",
]

COOLDOWN_COLUMNS = [
    "key_type",
    "key_value",
    "reason",
    "started_on",
    "eligible_on",
    "source_post_ids",
    "status",
]


def parse_optional_int(value):
    if value in (None, "", "NA"):
        return None
    return int(value)


def append_unique_row(path, columns, row, unique_key):
    path = Path(path)
    existing = []
    if path.exists():
        with path.open("r", encoding="utf-8-sig", newline="") as handle:
            existing = list(csv.DictReader(handle))
    if any(item.get(unique_key) == row.get(unique_key) for item in existing):
        raise ValueError(f"duplicate {unique_key}: {row.get(unique_key)}")
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=columns, extrasaction="raise")
        if handle.tell() == 0:
            writer.writeheader()
        writer.writerow({column: row.get(column, "NA") for column in columns})


def validate_performance_row(row, now_iso):
    errors = []
    published = datetime.fromisoformat(row["published_at"])
    now = datetime.fromisoformat(now_iso)
    for suffix, delta in SNAPSHOTS.items():
        collected = row.get(f"collected_at_{suffix}", "NA")
        if collected not in (None, "", "NA"):
            collected_at = datetime.fromisoformat(collected)
            if collected_at < published + delta:
                errors.append(f"{suffix} snapshot collected before due time")
            if collected_at > now:
                errors.append(f"{suffix} snapshot is in the future")
    return errors


def ensure_csv(path, columns):
    path = Path(path)
    if path.exists():
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8-sig", newline="") as handle:
        csv.DictWriter(handle, fieldnames=columns).writeheader()
