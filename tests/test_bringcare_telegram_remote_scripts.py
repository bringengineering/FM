from pathlib import Path


BASE = Path(__file__).parents[1] / "automation" / "bringcare_telegram"


def test_run_script_uses_utf8_module_workspace_and_propagates_errors():
    text = (BASE / "run-remote.ps1").read_text(encoding="utf-8")
    assert "[Console]::InputEncoding" in text
    assert "[Console]::OutputEncoding" in text
    assert "$PSScriptRoot" in text
    assert "Set-Location -LiteralPath" in text
    assert "python -X utf8 -m automation.bringcare_telegram.poller" in text
    assert "exit $LASTEXITCODE" in text
    assert "token" not in text.lower()


def test_installer_is_current_user_logon_hidden_idempotent_and_quotes_paths():
    text = (BASE / "install-remote-task.ps1").read_text(encoding="utf-8")
    lower = text.lower()
    assert "register-scheduledtask" in lower
    assert "unregister-scheduledtask" in lower
    assert "-atlogon" in lower
    assert "$env:username" in lower
    assert "-logontype interactive" in lower
    assert "-windowstyle hidden" in lower
    assert "$psscriptroot" in lower
    assert "-literalpath" in lower
    assert "-uninstall" in lower
    assert "password" not in lower
    assert "token" not in lower
    assert "run-remote.ps1" in lower
