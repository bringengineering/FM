from dataclasses import dataclass

from automation.bringcare_learning.alerts import get_alert_action


KINDS = {
    "LOGIN_EXPIRED": "naver_login_required",
    "CAPTCHA": "naver_captcha_required",
    "EDITOR_CHANGED": "naver_editor_changed",
    "POLICY_WARNING": "naver_policy_warning",
    "PUBLIC_QA_FAILED": "naver_public_qa_failed",
}


@dataclass(frozen=True)
class NotificationEvent:
    kind: str
    title: str
    action: str
    resume_point: str
    detected_at: str


def event_from_blocker(blocker, title, stage, detected_at):
    if blocker not in KINDS: raise ValueError(f"unknown blocker: {blocker}")
    return NotificationEvent(KINDS[blocker], title, get_alert_action(blocker), stage, detected_at)
