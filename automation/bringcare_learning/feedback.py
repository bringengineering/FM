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


def next_run_actions(
    now_iso=None,
    due_post_ids=None,
    candidate=None,
    collected_metrics=None,
):
    if due_post_ids:
        return [
            {"type": "collect_performance", "post_id": post_id}
            for post_id in due_post_ids
        ]
    if (
        candidate
        and candidate.get("post_type") == "현장사례"
        and not candidate.get("real_photo_available")
    ):
        return [
            {
                "type": "prepare_post",
                "status": "차단",
                "reason": "현장사례 실제 사진 부족",
            }
        ]
    if collected_metrics is not None:
        row = {
            key: ("NA" if value is None else value)
            for key, value in collected_metrics.items()
        }
        return [{"type": "record_performance", "row": row}]
    return [{"type": "research_candidates"}]
