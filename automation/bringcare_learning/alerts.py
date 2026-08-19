from datetime import datetime, timedelta


ACTIONS = {
    "LOGIN_EXPIRED": "브링케어 네이버 계정으로 다시 로그인해 주세요.",
    "CAPTCHA": "네이버 화면에서 CAPTCHA 또는 본인 확인을 완료해 주세요.",
    "EDITOR_CHANGED": "편집기 구조가 바뀌어 클릭을 중단했습니다. 화면 확인이 필요합니다.",
    "POLICY_WARNING": "계정 경고를 확인하기 전까지 추가 발행을 중단합니다.",
    "PUBLIC_QA_FAILED": "공개 페이지가 검수 기준과 달라 수정이 필요합니다.",
}


def build_alert(blocker, detected_at, stage, post_title):
    action = get_alert_action(blocker)
    return (
        f"[{blocker}] {detected_at}에 `{post_title}` 작업이 `{stage}` 단계에서 "
        f"중단되었습니다. 원고와 자산은 보존했습니다. {action} 해결 후 "
        f"`{stage}` 단계부터 재개합니다."
    )


def get_alert_action(blocker):
    if blocker not in ACTIONS:
        raise ValueError(f"unknown blocker: {blocker}")
    return ACTIONS[blocker]


def should_notify(last_notified_at, now_at, state_changed):
    if state_changed or not last_notified_at:
        return True
    last = datetime.fromisoformat(last_notified_at)
    now = datetime.fromisoformat(now_at)
    return now - last >= timedelta(hours=24)
