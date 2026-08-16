from __future__ import annotations

import math

WEIGHTS = {
    "demand": 24, "velocity": 16, "audience": 12, "utility": 14,
    "emotion": 10, "curiosity": 8, "visual": 8, "monetization": 4,
    "evidence": 4,
}

TRANSITIONS = {
    "discovered": {"researched", "failed"},
    "researched": {"scripted", "failed"},
    "scripted": {"queued", "failed"},
    "queued": {"generating", "failed"},
    "generating": {"assembled", "failed"},
    "assembled": {"qc_passed", "failed"},
    "qc_passed": {"scheduled", "failed"},
    "scheduled": {"published", "failed"},
    "published": {"measured", "failed"},
    "measured": set(),
    "failed": set(),
}


def _pct(value: float) -> float:
    return min(100.0, max(0.0, float(value)))


def score_topic(signals: dict) -> float:
    score = sum(_pct(signals.get(name, 0)) / 100 * weight for name, weight in WEIGHTS.items())
    score -= _pct(signals.get("duplicate", 0)) * 0.25
    score -= _pct(signals.get("risk", 0)) * 0.20
    return round(min(100.0, max(0.0, score)), 1)


def qc_summary(checks: list[dict]) -> dict:
    blocking = [c["name"] for c in checks if c.get("critical", True) and not c.get("passed", False)]
    return {"publishable": not blocking, "blocking": blocking,
            "passed": sum(bool(c.get("passed")) for c in checks), "total": len(checks)}


def can_transition(current: str, target: str, resume_stage: str | None = None) -> bool:
    if current == "failed":
        return bool(resume_stage and target == resume_stage and target in TRANSITIONS)
    return target in TRANSITIONS.get(current, set())


def build_kpi_report(current_subscribers: int, target_subscribers: int,
                     days_remaining: int, recent_daily_subscribers: float) -> dict:
    gap = max(0, target_subscribers - current_subscribers)
    required = math.ceil(gap / max(1, days_remaining))
    pace = round(recent_daily_subscribers / required, 2) if required else 1.0
    return {"current": current_subscribers, "target": target_subscribers, "gap": gap,
            "days_remaining": days_remaining, "required_daily": required,
            "recent_daily": recent_daily_subscribers, "pace_ratio": pace,
            "status": "on_track" if pace >= 1 else "gap"}
