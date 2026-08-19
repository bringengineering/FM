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
