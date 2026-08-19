# 브링케어 텔레그램 업무 리모컨

등록한 개인 텔레그램 채팅에서 브링케어 블로그의 상태를 조회하고, 수정 요청과 발행 승인·취소를 전달하는 Windows용 규칙형 리모컨입니다. 자연어를 AI에 보내지 않으므로 **OpenAI API 비용은 0원**입니다. 동작에 필요한 것은 텔레그램과 PC의 인터넷 통신뿐입니다. 다만 인터넷 회선, 네이버, 이미지 도구 등 외부 서비스 비용은 각 서비스 정책에 따라 별도입니다.

명령을 즉시 받으려면 PC가 켜져 있고, 설정한 사용자로 Windows에 로그인되어 있으며, 백그라운드 폴러가 실행 중이어야 합니다. 폴러는 조회·수정 요청 기록·승인 상태 변경만 담당합니다. 기존 Codex 자동화는 별도로 3시간마다 원고 생성, 검증과 네이버 브라우저 발행을 담당합니다. 따라서 텔레그램 응답이 왔다고 새 글 작성이나 실제 공개가 즉시 끝나는 것은 아닙니다.

## 지원 명령

아래 문장처럼 한 번에 한 가지 명령을 보냅니다. 문장 끝의 물음표·느낌표와 공백은 정리되지만, 지원하지 않는 명령을 의미로 추측하여 실행하지 않습니다.

| 의도 | 한국어 예시 |
| --- | --- |
| 현재 상태 | `어디까지 됐어?`, `지금 글 상태 알려줘`, `작성 중인 글 있어?` |
| 승인 대기 글 | `승인 기다리는 글 보여줘`, `올릴 글 뭐야?` |
| 최근 발행·링크 | `최근에 뭐 올렸어?`, `블로그 링크 줘`, `마지막 글 보여줘` |
| 다음 제작 시각 | `다음 글 몇 시야?`, `언제 또 만들어?` |
| 오늘 성과 | `오늘 성과 알려줘`, `오늘 조회수 어때?` |
| 오류·차단 상태 | `뭐가 문제야?`, `오류 상태 알려줘`, `막힌 거 있어?` |
| 제목 수정 요청 | `제목: 새 제목`, `제목을 "가을철 원룸 관리"로 바꿔줘` |
| 본문 수정 요청 | `본문에서 회사 소개를 더 짧게 수정해줘` |
| 발행 요청 시작 | `올려줘`, `발행해`, `진행해` |
| 최종 승인 | 정확히 `승인` |
| 승인 대기 취소 | 정확히 `취소` 또는 `보류` |
| 도움말 | `안녕`, `뭐 할 수 있어?`, `도움말` |

알 수 없는 문장에는 지원하지 않는 명령이라는 안내와 도움말 사용법만 회신합니다. 제목 수정과 본문 수정, 또는 수정과 발행을 한 메시지에 섞으면 한 번에 한 가지 명령만 보내 달라고 안내하고 아무 동작도 하지 않습니다.

### 승인·취소와 10분 규칙

`올려줘`, `발행해`, `진행해`는 공개하지 않고 현재 대기 글의 승인 시간을 10분으로 갱신합니다. 그 뒤 등록된 같은 개인 채팅에서 10분 안에 정확히 `승인`을 보내야 승인됩니다. `승인해줘`, `이 글 승인` 같은 유사 문구는 승인하지 않습니다. 정확히 `취소` 또는 `보류`를 보내면 현재 요청을 취소합니다. 10분이 지나 만료되었거나 대기 대상이 없으면 승인·취소 모두 실행되지 않으므로 발행 요청부터 다시 보냅니다.

제목·본문 명령은 수정 요청만 저장합니다. 기존 공개 글을 즉시 변경하지 않습니다. 저장된 요청은 이후 Codex 자동화가 대상과 내용을 검토·반영하며, 공개 상태를 바꾸는 단계에는 별도의 유효한 승인이 필요합니다.

## 최초 설정과 Windows 예약 작업

1. BotFather에서 봇 토큰을 발급합니다. 토큰이 노출된 적이 있다면 `/token`으로 폐기하고 새로 발급합니다.
2. 해당 봇의 개인 채팅에서 `/start`를 보냅니다.
3. 저장소 최상위 폴더에서 설정 스크립트를 실행하고, 숨김 입력창에 토큰을 붙여넣은 뒤 본인 Chat ID를 선택합니다.

```powershell
powershell -ExecutionPolicy Bypass -File automation/bringcare_telegram/setup-telegram.ps1
```

4. 현재 Windows 사용자 로그인 때 폴러가 자동 시작되도록 설치합니다.

```powershell
powershell -ExecutionPolicy Bypass -File automation/bringcare_telegram/install-remote-task.ps1
```

설치 직후 시작, 상태 확인, 제거 명령은 다음과 같습니다.

```powershell
Start-ScheduledTask -TaskName "BringCare Telegram Remote"
Get-ScheduledTask -TaskName "BringCare Telegram Remote"
Get-ScheduledTaskInfo -TaskName "BringCare Telegram Remote"
powershell -ExecutionPolicy Bypass -File automation/bringcare_telegram/install-remote-task.ps1 -Uninstall
```

문제 확인을 위해 전면에서 직접 실행할 때만 실제 실행기 `run-remote.ps1`을 사용합니다. 이미 예약 작업이 실행 중이면 먼저 중지해야 단일 인스턴스 잠금과 충돌하지 않습니다.

```powershell
Stop-ScheduledTask -TaskName "BringCare Telegram Remote"
powershell -ExecutionPolicy Bypass -File automation/bringcare_telegram/run-remote.ps1
```

## 운영용 CLI

알림·승인 원장을 직접 점검해야 할 때 사용할 수 있습니다.

```powershell
python -m automation.bringcare_telegram.cli test
python -m automation.bringcare_telegram.cli ready --post-id POST-001 --title "글 제목" --post-type "검색정보" --category "생활 속 관리정보"
python -m automation.bringcare_telegram.cli remote-once --timeout 0
python -m automation.bringcare_telegram.cli approval-status
python -m automation.bringcare_telegram.cli claim-approved --post-id POST-001
python -m automation.bringcare_telegram.cli mark-published --url "https://blog.naver.com/bringcare/게시물번호"
python -m automation.bringcare_telegram.cli blocked --post-id POST-001 --title "글 제목" --blocker LOGIN_EXPIRED --stage "발행 설정"
python -m automation.bringcare_telegram.cli published --post-id POST-001 --title "글 제목" --url "https://blog.naver.com/bringcare/게시물번호"
```

## 문제 해결

- **인증(401/403):** 봇 차단을 해제하고 `/start`를 다시 보냅니다. 토큰이 폐기되었거나 노출되었다면 재발급한 뒤 `setup-telegram.ps1`을 다시 실행합니다.
- **설정 오류:** `local-config.json`과 `token.dpapi`가 같은 Windows 사용자로 생성되었는지 확인하고 설정을 다시 실행합니다. 다른 Windows 계정에서는 DPAPI 토큰을 해독할 수 없습니다.
- **네트워크(시간 초과/429):** PC 인터넷 연결과 텔레그램 접속을 확인합니다. 429면 잠시 기다린 뒤 다시 시작합니다. 상태와 수정 요청은 보존됩니다.
- **단일 인스턴스 오류:** 작업 관리자에서 중복 Python 폴러가 없는지 확인하고, 예약 작업을 한 번만 설치합니다. 정상 폴러가 실행 중이면 두 번째 `run-remote.ps1`은 잠금 때문에 종료되는 것이 정상입니다.
- **예약 작업이 멈춤:** `Get-ScheduledTaskInfo`의 최근 결과를 확인하고 `Start-ScheduledTask`로 다시 시작합니다. 로그의 상태 코드만 확인하고 토큰을 붙여넣지 않습니다.
- **네이버 로그인/CAPTCHA/편집기 변경:** Windows에서 네이버에 다시 로그인하거나 본인 확인을 완료합니다. 폴러는 네이버 화면을 직접 조작하지 않으며 Codex 발행 회차에서 재개합니다.

## 보안과 로컬 데이터

봇 토큰은 `token.dpapi`에 Windows 현재 사용자 범위 DPAPI로 암호화되며 Git과 로그에 기록하지 않습니다. Chat ID와 로컬 설정, 승인·오프셋·알림 상태, 수정 요청, 잠금 파일도 Git에서 제외합니다. 명령 처리 후 일반 채팅 원문이나 대화 내역은 저장하지 않습니다. 단, 사용자가 보낸 제목·본문 수정 요청은 업무 처리를 위해 로컬 수정 요청 JSON에 필요한 내용만 저장됩니다.

토큰이나 Chat ID를 문서, 화면 캡처, 오류 보고에 붙여넣지 마십시오. 토큰 교체는 `setup-telegram.ps1`을 다시 실행합니다. 연동 중지에는 먼저 `install-remote-task.ps1 -Uninstall`을 실행하고, 필요하면 로컬의 `local-config.json`, `token.dpapi`, `telegram-state.json`, `approval-state.json`, `telegram-update-offset.json`과 `automation/state/bringcare-telegram-*` 런타임 파일을 별도로 삭제합니다.
