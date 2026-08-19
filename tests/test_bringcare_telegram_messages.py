from automation.bringcare_telegram.messages import blocked_message, published_message, ready_message


def test_ready_message_requests_direct_telegram_command_without_link():
    text, markup = ready_message("제목 <확인>", "검색정보", "생활정보")
    assert "발행 준비 완료" in text
    assert "&lt;확인&gt;" in text
    assert "승인" in text and "취소" in text
    assert "ChatGPT" not in text
    assert markup is None


def test_published_message_contains_title_and_url():
    text, markup = published_message("완료 제목", "https://blog.naver.com/bringcare/1")
    assert "완료 제목" in text and "https://blog.naver.com/bringcare/1" in text
    assert markup is None


def test_blocked_message_is_actionable():
    text, markup = blocked_message("글", "로그인이 만료되었습니다", "네이버에 다시 로그인", "발행 설정")
    assert "네이버에 다시 로그인" in text and "발행 설정" in text
    assert markup is None
