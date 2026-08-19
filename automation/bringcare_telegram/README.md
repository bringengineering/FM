# 브링케어 텔레그램 발행 알림

블로그 자동화의 발행 준비·차단·완료 상태를 운영자 개인 텔레그램으로 알립니다. 준비 완료 알림을 받은 뒤 같은 봇 채팅에 `승인`이라고 보내면 별도의 1분 감시 작업이 승인된 글만 발행합니다. `취소`라고 보내면 대기 중인 글을 취소합니다.

## 최초 설정

1. BotFather에서 노출된 기존 토큰을 `/token`으로 폐기하고 새 토큰을 발급합니다.
2. `@bringcare_blog_alert_bot`에서 `/start`를 보냅니다.
3. 저장소 최상위 폴더에서 아래 명령을 실행합니다.

```powershell
powershell -ExecutionPolicy Bypass -File automation/bringcare_telegram/setup-telegram.ps1
```

4. 새 토큰은 화면에 보이지 않는 입력창에 직접 붙여넣습니다. 채팅이나 문서에 적지 않습니다.
5. 기존 설정 화면에서 HTTPS 주소를 요구하면 기본값을 유지합니다. 텔레그램 직접 승인에는 이 주소를 사용하지 않습니다.
6. 감지된 개인 Chat ID 중 본인 대화를 선택합니다.
7. 연결 완료 메시지가 도착하는지 확인합니다.

토큰은 `token.dpapi`에 Windows 현재 사용자 범위로 암호화됩니다. 로컬 설정·토큰·상태 파일은 Git에서 제외됩니다.

## 운영 명령

```powershell
python -m automation.bringcare_telegram.cli test
python -m automation.bringcare_telegram.cli ready --post-id POST-001 --title "글 제목" --post-type "검색정보" --category "생활 속 관리정보"
python -m automation.bringcare_telegram.cli sync-approval
python -m automation.bringcare_telegram.cli approval-status
python -m automation.bringcare_telegram.cli claim-approved --post-id POST-001
python -m automation.bringcare_telegram.cli mark-published --url "https://blog.naver.com/bringcare/게시물번호"
python -m automation.bringcare_telegram.cli blocked --post-id POST-001 --title "글 제목" --blocker LOGIN_EXPIRED --stage "발행 설정"
python -m automation.bringcare_telegram.cli published --post-id POST-001 --title "글 제목" --url "https://blog.naver.com/bringcare/게시물번호"
```

승인 대기는 24시간 동안 유효하며 동시에 글 한 개만 대기할 수 있습니다. 등록된 개인 채팅의 정확한 `승인`과 `취소`만 처리합니다. 승인 메시지는 한 번만 사용되고 발행 작업이 선점하면 다시 사용할 수 없습니다.

## 장애 조치

- 401: BotFather에서 토큰을 재발급하고 설정을 다시 실행합니다.
- 403: 봇 차단을 해제하고 `/start`를 다시 보냅니다.
- 429: 잠시 기다린 뒤 다시 시도합니다. 원고와 이미지는 보존됩니다.
- 시간 초과: 인터넷 연결 확인 후 같은 명령을 다시 실행합니다.
- 네이버 로그인 만료: 다시 로그인한 뒤 중단 지점에서 재개합니다.
- CAPTCHA: 네이버 화면에서 본인 확인을 직접 완료합니다.
- 편집기 변경: 자동 클릭을 멈추고 화면 구조를 확인합니다.

토큰을 교체할 때는 설정 스크립트를 다시 실행합니다. 연동을 중지하려면 `local-config.json`, `token.dpapi`, `telegram-state.json`, `approval-state.json`, `telegram-update-offset.json`을 삭제합니다.
