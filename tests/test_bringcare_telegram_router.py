import pytest

from automation.bringcare_telegram.router import Command, route


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
    assert route(text).intent == intent


def test_normalizes_unicode_whitespace_and_terminal_punctuation():
    command = route("\u3000 지금\t글\n상태 알려줘？！…  ")

    assert command == Command("status", None, "지금 글 상태 알려줘")


def test_approval_requires_the_exact_normalized_command():
    assert route("  승인！ ").intent == "approve"
    assert route("승인해줘").intent == "unknown"
    assert route("이 글 승인").intent == "unknown"


@pytest.mark.parametrize("text", ["취소해줘", "이 글 보류", "보류해줘"])
def test_cancel_requires_an_exact_normalized_command(text):
    assert route(text).intent == "unknown"


def test_extracts_title_revision_payload():
    command = route("제목을 가을철 원룸 관리로 바꿔줘.")

    assert command == Command("revise_title", "가을철 원룸 관리", "제목을 가을철 원룸 관리로 바꿔줘")


def test_extracts_title_before_euro_particle_without_truncating_it():
    command = route("제목을 우리 집으로 바꿔줘")

    assert command.payload == "우리 집"


def test_extracts_meaningful_body_revision_payload():
    command = route("본문에서 회사 소개를 더 짧게 수정해줘!")

    assert command == Command(
        "revise_body", "회사 소개를 더 짧게", "본문에서 회사 소개를 더 짧게 수정해줘"
    )


@pytest.mark.parametrize(
    ("text", "payload"),
    [
        ("본문에서 제목을 더 눈에 띄게 수정해줘", "제목을 더 눈에 띄게"),
        ("본문에서 본문이라는 표현을 줄여서 수정해줘", "본문이라는 표현을 줄여서"),
        ("본문에서 올려줘 표현을 정중하게 수정해줘", "올려줘 표현을 정중하게"),
        ("본문에서 진행해라는 표현을 수정해줘", "진행해라는 표현을"),
    ],
)
def test_reserved_words_inside_body_payload_are_not_extra_actions(text, payload):
    assert route(text) == Command("revise_body", payload, text)


def test_rejects_multiple_mutation_actions_as_ambiguous():
    command = route("제목 바꾸고 본문도 수정해줘")

    assert command.intent == "ambiguous"
    assert command.payload is None


def test_arbitrary_text_is_unknown_without_semantic_guessing():
    assert route("가을철 원룸 관리가 궁금해").intent == "unknown"


def test_command_is_immutable():
    command = route("도움말")

    with pytest.raises((AttributeError, TypeError)):
        command.intent = "approve"
