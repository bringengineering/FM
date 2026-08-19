from pathlib import Path


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
