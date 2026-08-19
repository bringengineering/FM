from automation.bringcare_telegram.cli import main


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


def test_sync_approval_reads_updates_and_advances_offset(monkeypatch, capsys):
    class Config:
        chat_id = "1234"

    class Client:
        def get_updates(self, offset=None):
            assert offset == 4
            return [{"update_id": 4, "message": {"chat": {"id": 1234, "type": "private"}, "text": "승인"}}]

        def send_message(self, chat_id, text, reply_markup):
            assert chat_id == "1234" and "승인 확인" in text

    class Offsets:
        def load(self): return 4
        def save(self, value): assert value == 5

    monkeypatch.setattr("automation.bringcare_telegram.cli.load_public_config", lambda path: Config())
    monkeypatch.setattr("automation.bringcare_telegram.cli.load_client", lambda: Client())
    monkeypatch.setattr("automation.bringcare_telegram.cli.UpdateOffsetStore", lambda path: Offsets())
    monkeypatch.setattr(
        "automation.bringcare_telegram.cli.apply_updates",
        lambda updates, allowed_chat_id, store: type("Result", (), {"approved": 1, "cancelled": 0, "last_update_id": 4})(),
    )

    assert main(["sync-approval"]) == 0
    assert "approved" in capsys.readouterr().out
