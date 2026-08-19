from pathlib import Path
import subprocess


README = Path("automation/bringcare_telegram/README.md")


def test_setup_uses_hidden_input_and_dpapi():
    text = Path("automation/bringcare_telegram/setup-telegram.ps1").read_text(encoding="utf-8")
    assert "Read-Host \"New Telegram Bot Token\" -AsSecureString" in text
    assert "CurrentUser" in text
    assert "Write-Host $token" not in text
    assert "http://" not in text


def test_setup_prompts_are_windows_powershell_safe_ascii():
    text = Path("automation/bringcare_telegram/setup-telegram.ps1").read_text(encoding="utf-8")
    assert text.isascii()


def test_setup_waits_for_start_instead_of_checking_only_once():
    text = Path("automation/bringcare_telegram/setup-telegram.ps1").read_text(encoding="utf-8")
    assert "for ($attempt = 1; $attempt -le 30; $attempt++)" in text
    assert "Start-Sleep -Seconds 2" in text


def test_setup_displays_username_returned_by_get_me():
    text = Path("automation/bringcare_telegram/setup-telegram.ps1").read_text(encoding="utf-8")
    assert "$botUsername = $identity.result.username" in text
    assert "@$botUsername" in text
    assert "@bringcare_blog_alert_bot" not in text


def test_setup_loads_dpapi_assembly_before_using_protected_data():
    text = Path("automation/bringcare_telegram/setup-telegram.ps1").read_text(encoding="utf-8")
    load_at = text.index("Add-Type -AssemblyName System.Security")
    protect_at = text.index("[Security.Cryptography.ProtectedData]::Protect")
    assert load_at < protect_at


def test_readme_documents_every_remote_intent_with_korean_examples():
    text = README.read_text(encoding="utf-8")
    examples = (
        "어디까지 됐어", "승인 기다리는 글 보여줘", "최근에 뭐 올렸어",
        "다음 글 몇 시야", "오늘 성과 알려줘", "뭐가 문제야",
        "제목: 새 제목", "본문에서 회사 소개를 더 짧게 수정해줘",
        "올려줘", "승인", "취소", "보류", "도움말",
    )
    for example in examples:
        assert example in text


def test_readme_explains_cost_runtime_and_responsibility_boundaries():
    text = README.read_text(encoding="utf-8")
    for phrase in (
        "OpenAI API 비용은 0원", "텔레그램과 PC의 인터넷 통신",
        "외부 서비스 비용", "PC가 켜져", "Windows에 로그인",
        "백그라운드 폴러", "3시간", "Codex", "원고 생성", "네이버 브라우저 발행",
    ):
        assert phrase in text


def test_readme_explains_exact_approval_expiry_and_safe_revision_behavior():
    text = README.read_text(encoding="utf-8")
    for phrase in (
        "정확히 `승인`", "정확히 `취소`", "10분", "만료",
        "지원하지 않는 명령", "한 번에 한 가지", "추측",
        "수정 요청만 저장", "공개 글을 즉시 변경하지 않습니다",
    ):
        assert phrase in text


def test_readme_has_windows_task_lifecycle_commands_using_actual_scripts():
    text = README.read_text(encoding="utf-8")
    for phrase in (
        "setup-telegram.ps1", "install-remote-task.ps1", "run-remote.ps1",
        "Start-ScheduledTask -TaskName \"BringCare Telegram Remote\"",
        "Get-ScheduledTask -TaskName \"BringCare Telegram Remote\"",
        "install-remote-task.ps1 -Uninstall",
    ):
        assert phrase in text


def test_readme_covers_operations_security_and_troubleshooting():
    text = README.read_text(encoding="utf-8")
    for phrase in (
        "인증", "설정", "네트워크", "단일 인스턴스", "DPAPI",
        "토큰", "일반 채팅 원문이나 대화 내역은 저장하지 않습니다", "로그",
    ):
        assert phrase in text


def test_gitignore_excludes_runtime_state_without_hiding_source_or_tests():
    ignored = (
        "automation/bringcare_telegram/approval-state.json",
        "automation/bringcare_telegram/telegram-update-offset.json",
        "automation/state/bringcare-telegram-revisions.json",
        "automation/state/bringcare-telegram-revisions.json.lock",
        "automation/state/bringcare-telegram-poller.lock",
        "automation/state/bringcare-telegram-poller.log",
    )
    for path in ignored:
        result = subprocess.run(
            ["git", "check-ignore", "-q", "--", path], check=False
        )
        assert result.returncode == 0, path

    tracked_contracts = (
        "automation/bringcare_telegram/remote.py",
        "automation/bringcare_telegram/README.md",
        "tests/test_bringcare_telegram_remote.py",
    )
    for path in tracked_contracts:
        result = subprocess.run(
            ["git", "check-ignore", "-q", "--no-index", "--", path], check=False
        )
        assert result.returncode == 1, path
