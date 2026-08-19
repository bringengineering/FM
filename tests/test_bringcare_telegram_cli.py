import json

import pytest

from automation.bringcare_telegram.cli import _parser, main
from automation.bringcare_telegram.client import TelegramAuthError, TelegramTemporaryError


def test_ready_command_dispatches_once(monkeypatch, capsys):
    sent = []
    monkeypatch.setattr("automation.bringcare_telegram.cli.send_event", lambda event: sent.append(event) or True)
    pending = []
    monkeypatch.setattr("automation.bringcare_telegram.cli.register_pending", lambda *args: pending.append(args))
    code = main(["ready", "--post-id", "p1", "--title", "제목", "--post-type", "검색정보", "--category", "생활정보"])
    assert code == 0 and len(sent) == 1
    assert len(pending) == 1
    assert "승인" in sent[0].text and sent[0].markup is None
    assert "token" not in capsys.readouterr().out.lower()


def test_remote_commands_parse_and_validate_bounded_timeout():
    assert _parser().parse_args(["sync-commands"]).command == "sync-commands"
    assert _parser().parse_args(["sync-approval"]).command == "sync-approval"
    assert _parser().parse_args(["remote-once"]).timeout == 30
    assert _parser().parse_args(["remote-once", "--timeout", "50"]).timeout == 50
    for value in ("-1", "51", "not-a-number"):
        with pytest.raises(SystemExit):
            _parser().parse_args(["remote-once", "--timeout", value])


@pytest.mark.parametrize("command", ["sync-commands", "sync-approval"])
def test_sync_aliases_use_shared_remote_processor(monkeypatch, capsys, command):
    calls = []
    monkeypatch.setattr(
        "automation.bringcare_telegram.cli.process_remote_once",
        lambda timeout=0: calls.append(timeout) or {"status": "ok", "updates": 1, "replies": 1, "actions": 0, "approved": 0, "cancelled": 0},
    )

    assert main([command]) == 0
    assert calls == [0]
    assert json.loads(capsys.readouterr().out) == {
        "status": "ok", "updates": 1, "replies": 1, "actions": 0, "approved": 0, "cancelled": 0
    }


def test_remote_once_passes_timeout(monkeypatch, capsys):
    calls = []
    monkeypatch.setattr(
        "automation.bringcare_telegram.cli.process_remote_once",
        lambda timeout=0: calls.append(timeout) or {"status": "ok", "updates": 0, "replies": 0, "actions": 0, "approved": 0, "cancelled": 0},
    )
    assert main(["remote-once", "--timeout", "12"]) == 0
    assert calls == [12]
    assert json.loads(capsys.readouterr().out)["status"] == "ok"


def test_process_remote_once_has_one_getupdates_owner_sends_html_replies_and_saves_offset(monkeypatch, tmp_path):
    class Config:
        chat_id = "1234"

    class Client:
        def __init__(self): self.get_calls = []; self.sent = []
        def get_updates(self, offset=None, timeout=0):
            self.get_calls.append((offset, timeout))
            assert offset == 5
            return [
                {"update_id": 5, "message": {"chat": {"id": 9999, "type": "private"}, "text": "secret ignored"}},
                {"update_id": 6, "message": {"chat": {"id": 1234, "type": "private"}, "text": "도움말"}},
            ]

        def send_message(self, chat_id, text, reply_markup):
            self.sent.append((chat_id, text, reply_markup))

    class Offsets:
        def load(self): return 4
        def save(self, value): self.saved = value

    client, offsets = Client(), Offsets()
    monkeypatch.setattr("automation.bringcare_telegram.cli.load_public_config", lambda path: Config())
    monkeypatch.setattr("automation.bringcare_telegram.cli.load_client", lambda: client)
    monkeypatch.setattr("automation.bringcare_telegram.cli.UpdateOffsetStore", lambda path: offsets)
    monkeypatch.setattr("automation.bringcare_telegram.cli.APPROVAL_STORE", tmp_path / "approval.json")
    monkeypatch.setattr("automation.bringcare_telegram.cli.REVISION_STORE", tmp_path / "revisions.json")
    monkeypatch.setattr("automation.bringcare_telegram.cli.WORKSPACE_ROOT", tmp_path)

    from automation.bringcare_telegram.cli import process_remote_once
    output = process_remote_once(timeout=7)

    assert client.get_calls == [(5, 7)]
    assert offsets.saved == 6
    assert len(client.sent) == 1
    assert client.sent[0][0] == "1234" and client.sent[0][2] is None
    assert output == {"status": "ok", "updates": 2, "replies": 1, "actions": 0, "approved": 0, "cancelled": 0}


def test_process_remote_once_does_not_save_offset_when_reply_fails(monkeypatch, tmp_path):
    class Config: chat_id = "1234"
    class Client:
        def get_updates(self, offset=None, timeout=0):
            return [{"update_id": 9, "message": {"chat": {"id": 1234, "type": "private"}, "text": "도움말"}}]
        def send_message(self, chat_id, text, reply_markup):
            raise RuntimeError("send failed")
    class Offsets:
        def load(self): return None
        def save(self, value): pytest.fail("offset must not advance")

    monkeypatch.setattr("automation.bringcare_telegram.cli.load_public_config", lambda path: Config())
    monkeypatch.setattr("automation.bringcare_telegram.cli.load_client", lambda: Client())
    monkeypatch.setattr("automation.bringcare_telegram.cli.UpdateOffsetStore", lambda path: Offsets())
    monkeypatch.setattr("automation.bringcare_telegram.cli.APPROVAL_STORE", tmp_path / "approval.json")
    monkeypatch.setattr("automation.bringcare_telegram.cli.REVISION_STORE", tmp_path / "revisions.json")
    monkeypatch.setattr("automation.bringcare_telegram.cli.WORKSPACE_ROOT", tmp_path)

    from automation.bringcare_telegram.cli import process_remote_once
    with pytest.raises(RuntimeError, match="send failed"):
        process_remote_once()


@pytest.mark.parametrize(
    ("error", "code"),
    [
        (FileNotFoundError("secret path"), 3),
        (ValueError("token raw text"), 3),
        (TelegramAuthError("token raw text"), 4),
        (TelegramTemporaryError("user raw text"), 5),
    ],
)
def test_remote_command_sanitizes_mapped_errors(monkeypatch, capsys, error, code):
    monkeypatch.setattr("automation.bringcare_telegram.cli.process_remote_once", lambda timeout=0: (_ for _ in ()).throw(error))
    assert main(["sync-commands"]) == code
    captured = capsys.readouterr()
    assert all(raw not in captured.err for raw in ("secret path", "token raw text", "user raw text"))
