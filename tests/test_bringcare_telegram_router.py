import pytest

from automation.bringcare_telegram.router import Command, route_command


@pytest.mark.parametrize(
    ("text", "intent"),
    [
        ("어디까지 됐어?", "status"),
        ("지금 글 상태 알려줘", "status"),
        ("작성 중인 글 있어?", "status"),
        ("승인 기다리는 글 보여줘", "pending"),
        ("올릴 글 뭐야?", "pending"),
        ("최근에 뭐 올렸어?", "latest"),
        ("블로그 링크 줘", "latest"),
        ("마지막 글 보여줘", "latest"),
        ("다음 글 몇 시야?", "schedule"),
        ("언제 또 만들어?", "schedule"),
        ("오늘 성과 알려줘", "performance"),
        ("오늘 조회수 어때?", "performance"),
        ("뭐가 문제야?", "error"),
        ("오류 상태 알려줘", "error"),
        ("막힌 거 있어?", "error"),
        ("올려줘", "publish_request"),
        ("발행해", "publish_request"),
        ("진행해", "publish_request"),
        ("취소", "cancel"),
        ("보류", "cancel"),
        ("안녕", "help"),
        ("뭐 할 수 있어?", "help"),
        ("도움말", "help"),
    ],
)
def test_routes_representative_korean_commands(text, intent):
    assert route_command(text).intent == intent


def test_normalizes_unicode_whitespace_and_terminal_punctuation():
    command = route_command("\u3000 지금\t글\n상태 알려줘？！…  ")

    assert command == Command("status", None, "지금 글 상태 알려줘")


def test_approval_requires_the_exact_normalized_command():
    assert route_command("  승인！ ").intent == "approve"
    assert route_command("승인해줘").intent == "unknown"
    assert route_command("이 글 승인").intent == "unknown"


def test_extracts_title_revision_payload():
    command = route_command("제목을 가을철 원룸 관리로 바꿔줘.")

    assert command == Command("revise_title", "가을철 원룸 관리", "제목을 가을철 원룸 관리로 바꿔줘")


def test_extracts_meaningful_body_revision_payload():
    command = route_command("본문에서 회사 소개를 더 짧게 수정해줘!")

    assert command == Command(
        "revise_body", "회사 소개를 더 짧게", "본문에서 회사 소개를 더 짧게 수정해줘"
    )


def test_rejects_multiple_mutation_actions_as_ambiguous():
    command = route_command("제목 바꾸고 본문도 수정해줘")

    assert command.intent == "ambiguous"
    assert command.payload is None


def test_arbitrary_text_is_unknown_without_semantic_guessing():
    assert route_command("가을철 원룸 관리가 궁금해").intent == "unknown"


def test_command_is_immutable():
    command = route_command("도움말")

    with pytest.raises((AttributeError, TypeError)):
        command.intent = "approve"
