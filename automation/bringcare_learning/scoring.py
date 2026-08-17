from dataclasses import dataclass
from statistics import median


WEIGHTS = {
    "current_interest": 20,
    "intent": 20,
    "business_relevance": 20,
    "evidence_and_image": 15,
    "differentiation": 15,
    "historical_performance": 10,
}

HARD_GATES = [
    "fact_safe",
    "business_relevant",
    "title_body_match",
    "privacy_rights_safe",
    "self_action_safe",
    "field_evidence_ready",
]


@dataclass(frozen=True)
class CandidateResult:
    score: int
    status: str
    hard_fails: tuple[str, ...]


def score_candidate(candidate):
    hard_fails = tuple(key for key in HARD_GATES if not candidate.get(key, False))
    score = sum(
        max(0, min(int(candidate.get(key, 0)), limit))
        for key, limit in WEIGHTS.items()
    )
    if hard_fails:
        return CandidateResult(score, "제외", hard_fails)
    status = "작성승인" if score >= 70 else "수정후승인" if score >= 60 else "제외"
    return CandidateResult(score, status, ())


def diagnose_post(metrics):
    labels = []
    if int(metrics.get("consultations", 0) or 0) > 0:
        labels.append("CONVERSION_WIN")
    elif metrics.get("views") is not None and metrics.get("peer_median_views") is not None:
        if metrics["views"] < metrics["peer_median_views"] * 0.5:
            labels.append("TOPIC_WEAK")
    if not labels:
        labels.append("INSUFFICIENT_DATA")
    return labels


def cooldown_days(recent_labels):
    return 60 if recent_labels[-3:] == ["TOPIC_WEAK"] * 3 else 0


def peer_median(values):
    clean = [float(value) for value in values if value not in (None, "", "NA")]
    if len(clean) < 20:
        return None, "잠정"
    return median(clean), "확정"
