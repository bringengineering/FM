import json
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

from automation.bringcare_telegram.queries import BlogQueries


SEOUL = ZoneInfo("Asia/Seoul")


def make_queries(tmp_path: Path, **overrides) -> BlogQueries:
    paths = {
        "approval_path": tmp_path / "approval.json",
        "backlog_path": tmp_path / "backlog.md",
        "ledger_path": tmp_path / "ledger.csv",
        "alerts_path": tmp_path / "alerts.md",
        "config_path": tmp_path / "config.json",
        "clock": lambda: datetime(2026, 8, 20, 12, 0, tzinfo=SEOUL),
    }
    paths.update(overrides)
    return BlogQueries(tmp_path, **paths)


def write(path: Path, text: str, encoding: str = "utf-8") -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding=encoding)


def test_current_status_distinguishes_missing_pending_and_published(tmp_path):
    queries = make_queries(tmp_path)
    assert queries.current_status() == "현재 상태: 확인된 기록이 없습니다"

    write(
        tmp_path / "approval.json",
        json.dumps({"status": "pending", "title": "여름철 배수구 점검"}, ensure_ascii=False),
    )
    assert queries.current_status() == "현재 상태: 승인 대기 · 여름철 배수구 점검"

    write(
        tmp_path / "approval.json",
        json.dumps(
            {
                "status": "published",
                "title": "발행 글",
                "published_url": "https://blog.naver.com/bringcare/123",
            },
            ensure_ascii=False,
        ),
    )
    assert queries.current_status() == (
        "현재 상태: 발행 완료 · 발행 글\nhttps://blog.naver.com/bringcare/123"
    )


def test_pending_post_uses_approval_then_latest_backlog_candidate(tmp_path):
    queries = make_queries(tmp_path)
    write(tmp_path / "approval.json", '{"status":"pending","title":"승인 글"}')
    write(
        tmp_path / "backlog.md",
        "# 원장\n## 2026-08-20 09시 회차\n- 상태: 후보\n- 제목: 이전 후보\n"
        "## 2026-08-20 11시 회차\n- 상태: 발행 전 확인 대기\n- 제목: 다음 글\n",
    )
    assert queries.pending_post() == "대기 글: 승인 글 · 승인 대기"

    write(tmp_path / "approval.json", '{"status":"published","title":"완료"}')
    assert queries.pending_post() == "대기 글: 다음 글 · 발행 전 확인 대기"


def test_latest_publications_sorts_timestamps_and_skips_unsafe_or_malformed_rows(tmp_path):
    queries = make_queries(tmp_path)
    write(
        tmp_path / "ledger.csv",
        "extra,published_at,title,public_url\n"
        "x,2026-08-18T09:00:00+09:00,오래된 글,https://blog.naver.com/bringcare/1\n"
        "x,not-a-date,깨진 글,https://example.com/bad\n"
        "x,2026-08-20T10:00:00+09:00,최신 글,https://blog.naver.com/bringcare/3\n"
        "x,2026-08-19T10:00:00+09:00,중간 글,javascript:alert(1)\n",
        encoding="utf-8-sig",
    )
    assert queries.latest_publications(limit=2) == (
        "최근 발행:\n"
        "- 2026-08-20 10:00 · 최신 글 · https://blog.naver.com/bringcare/3\n"
        "- 2026-08-19 10:00 · 중간 글 · URL NA"
    )


def test_next_preparation_time_uses_latest_real_backlog_heading_plus_three_hours(tmp_path):
    queries = make_queries(
        tmp_path,
        clock=lambda: datetime(2026, 8, 20, 14, 0, tzinfo=SEOUL),
    )
    write(tmp_path / "backlog.md", "# 운영 백로그\n"
          "## 2026-08-20 10:30 7회차 준비 완료\n- 상태: 완료\n"
          "## 2026-08-19 18시 실행 기록\n- 상태: 완료\n"
          "## 참고 2026-08-21 09:00\n- 날짜일 뿐 실행 기록 아님\n"
          "## 2026-08-20 08시 6회차\n- 상태: 완료\n")
    assert queries.next_preparation_time() == "다음 준비 시각: 2026-08-20 13:30 · 지연"

    write(tmp_path / "backlog.md", "## 준비 시각 미정\n## 2026-99-99 25시 실행\n")
    assert queries.next_preparation_time() == "다음 준비 시각: NA"


def test_today_performance_reports_only_actual_metrics(tmp_path):
    queries = make_queries(tmp_path)
    write(
        tmp_path / "ledger.csv",
        "title,published_at,views_72h,comments_72h,consultations_72h,unknown\n"
        "오늘 글,2026-08-20T01:00:00+00:00,125,NA,2,x\n"
        "어제 글,2026-08-19T01:00:00+00:00,999,5,8,x\n",
    )
    assert queries.today_performance() == "오늘 성과: 발행 1건 · 조회 125 · 상담 2"


def test_today_performance_does_not_invent_zero(tmp_path):
    queries = make_queries(tmp_path)
    write(tmp_path / "ledger.csv", "title,published_at,views_72h\n오늘 글,2026-08-20T10:00:00+09:00,NA\n")
    assert queries.today_performance() == "오늘 성과: 발행 1건"
    (tmp_path / "ledger.csv").unlink()
    assert queries.today_performance() == "오늘 성과: 확인된 기록이 없습니다"


def test_today_performance_ignores_extra_csv_cells_with_none_key(tmp_path):
    queries = make_queries(tmp_path)
    write(
        tmp_path / "ledger.csv",
        "title,published_at,views_72h\n"
        "정상 지표,2026-08-20T10:00:00+09:00,41,초과값,또다른값\n",
    )
    assert queries.today_performance() == "오늘 성과: 발행 1건 · 조회 41"


def test_latest_error_returns_latest_open_actionable_alert_and_redacts_secrets(tmp_path):
    queries = make_queries(tmp_path)
    write(
        tmp_path / "alerts.md",
        "# 장애 원장\n## 열린 장애\n"
        "### 2026-08-19 10:00 업로드 실패\n- 조치: 다시 업로드\n"
        "### 2026-08-20 09:30 Telegram 실패\n- 조치: token=abc123으로 재시도\n"
        "## 해결된 장애\n### 2026-08-20 10:00 해결됨\n- 조치: 없음\n",
    )
    assert queries.latest_error() == "최근 오류: 2026-08-20 09:30 Telegram 실패 · 조치: [민감정보 숨김]"


def test_latest_error_redacts_telegram_bot_tokens_embedded_in_urls(tmp_path):
    queries = make_queries(tmp_path)
    write(
        tmp_path / "alerts.md",
        "## 열린 장애\n"
        "### 2026-08-20 10:00 Telegram API 실패\n"
        "- 조치: https://api.telegram.org/bot123456:ABCDEF/sendMessage 재시도\n",
    )
    answer = queries.latest_error()
    assert answer == "최근 오류: 2026-08-20 10:00 Telegram API 실패 · 조치: [민감정보 숨김]"
    assert "123456:ABCDEF" not in answer


def test_latest_error_redacts_bare_bot_token_shape(tmp_path):
    queries = make_queries(tmp_path)
    write(
        tmp_path / "alerts.md",
        "## 열린 장애\n### 2026-08-20 10:00 전송 실패\n"
        "- 조치: 봇 987654321:secret_VALUE 토큰으로 확인\n",
    )
    answer = queries.latest_error()
    assert answer.endswith("조치: [민감정보 숨김]")
    assert "987654321:secret_VALUE" not in answer


def test_latest_error_redacts_secrets_from_heading_and_action(tmp_path):
    queries = make_queries(tmp_path)
    secrets = (
        "NAVER_PASSWORD=hunter2",
        "session_cookie=abc123xyz",
        "TELEGRAM_BOT_TOKEN=123456:ABCDEF",
    )
    write(
        tmp_path / "alerts.md",
        "## 열린 장애\n"
        f"### 2026-08-20 10:00 로그인 실패 {secrets[0]}\n"
        f"- 조치: {secrets[1]} 및 {secrets[2]} 확인\n",
    )
    answer = queries.latest_error()
    assert answer == "최근 오류: [민감정보 숨김] · 조치: [민감정보 숨김]"
    for secret in secrets:
        assert secret not in answer
    assert "hunter2" not in answer
    assert "abc123xyz" not in answer
    assert "123456:ABCDEF" not in answer


def test_latest_error_does_not_over_redact_ordinary_cookie_word(tmp_path):
    queries = make_queries(tmp_path)
    write(
        tmp_path / "alerts.md",
        "## 열린 장애\n### 2026-08-20 10:00 브라우저 오류\n"
        "- 조치: 쿠키 설정 확인 후 다시 로그인\n",
    )
    assert queries.latest_error() == (
        "최근 오류: 2026-08-20 10:00 브라우저 오류 · 조치: 쿠키 설정 확인 후 다시 로그인"
    )


def test_latest_error_keeps_non_secret_operational_assignments(tmp_path):
    queries = make_queries(tmp_path)
    action = "token_count=120, password_attempts=3, cookie_retry=2 확인"
    write(
        tmp_path / "alerts.md",
        f"## 열린 장애\n### 2026-08-20 10:00 집계 지연\n- 조치: {action}\n",
    )
    assert queries.latest_error() == f"최근 오류: 2026-08-20 10:00 집계 지연 · 조치: {action}"


def test_redaction_recognizes_only_explicit_secret_variable_names():
    secret_assignments = (
        "token=abc123",
        "password=hunter2",
        "passwd=hunter2",
        "cookie=sessionvalue",
        "secret=hiddenvalue",
        "credential=hiddenvalue",
        "TELEGRAM_BOT_TOKEN=123456:ABCDEF",
        "NAVER_PASSWORD=hunter2",
        "SESSION_COOKIE=abc123xyz",
        "API_KEY=keyvalue",
        "CHAT_ID=123456",
    )
    for assignment in secret_assignments:
        assert BlogQueries._redact(f"{assignment} 확인") == "[민감정보 숨김]"

    ordinary_assignments = ("token_count=120", "password_attempts=3", "cookie_retry=2")
    for assignment in ordinary_assignments:
        assert BlogQueries._redact(assignment) == assignment


def test_malformed_and_missing_sources_return_na_messages_without_writes(tmp_path):
    queries = make_queries(tmp_path)
    write(tmp_path / "approval.json", "[]")
    write(tmp_path / "ledger.csv", "bad\n\ud55c\uae00\n")
    write(tmp_path / "alerts.md", "## 열린 장애\n없음\n")
    before = {path: path.read_bytes() for path in tmp_path.iterdir()}

    assert queries.pending_post() == "대기 글: 확인된 기록이 없습니다"
    assert queries.latest_publications() == "최근 발행: 확인된 기록이 없습니다"
    assert queries.latest_error() == "최근 오류: 확인된 기록이 없습니다"
    assert {path: path.read_bytes() for path in tmp_path.iterdir()} == before


def test_unknown_approval_status_is_not_reported_as_an_operational_fact(tmp_path):
    queries = make_queries(tmp_path)
    write(tmp_path / "approval.json", '{"status":"mystery","title":"추측 금지"}')
    assert queries.current_status() == "현재 상태: 확인된 기록이 없습니다"


def test_current_status_does_not_promote_backlog_candidate_without_approval_state(tmp_path):
    queries = make_queries(tmp_path)
    write(
        tmp_path / "backlog.md",
        "## 2026-08-20 11시 회차\n- 상태: 발행 전 확인 대기\n- 제목: 다음 후보\n",
    )
    assert queries.current_status() == "현재 상태: 확인된 기록이 없습니다"
    assert queries.pending_post() == "대기 글: 다음 후보 · 발행 전 확인 대기"
