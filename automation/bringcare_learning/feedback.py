from datetime import datetime

from automation.bringcare_learning.schema import SNAPSHOTS


def due_snapshots(row, now_iso):
    published = datetime.fromisoformat(row["published_at"])
    now = datetime.fromisoformat(now_iso)
    due = []
    for suffix, delta in SNAPSHOTS.items():
        if now >= published + delta and row.get(
            f"collected_at_{suffix}", "NA"
        ) in (None, "", "NA"):
            due.append(suffix)
    return due


def manual_change_candidate(rule_key, evidence_ids, existing_rule, proposed_rule):
    unique = sorted(set(evidence_ids))
    if len(unique) < 3:
        return None
    return {
        "rule_key": rule_key,
        "evidence_ids": unique,
        "existing_rule": existing_rule,
        "proposed_rule": proposed_rule,
        "approval_status": "검토대기",
    }
