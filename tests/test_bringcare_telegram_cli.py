from automation.bringcare_telegram.cli import main


def test_ready_command_dispatches_once(monkeypatch, capsys):
    sent = []
    monkeypatch.setattr("automation.bringcare_telegram.cli.send_event", lambda event: sent.append(event) or True)
    code = main(["ready", "--post-id", "p1", "--title", "제목", "--post-type", "검색정보", "--category", "생활정보"])
    assert code == 0 and len(sent) == 1
    assert "token" not in capsys.readouterr().out.lower()
