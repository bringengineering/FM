# Google Drive 자동 재연결

CRM은 Google Drive의 짧은 접근 토큰만 저장하지 않는다. 사용자가 한 번 동의하면
OAuth Authorization Code + PKCE로 받은 갱신 토큰을 Windows `safeStorage`로 암호화해
CRM 사용자 UID와 함께 로컬에 저장한다. 앱 시작 시 만료가 5분 이내인 접근 토큰을
자동 갱신하며, Drive가 `401`을 반환하면 한 번 갱신한 뒤 같은 요청을 한 번만 다시
시도한다.

Google에서 권한이 철회되어 `invalid_grant`가 반환된 경우에만 암호화 저장 파일을
지우고 사용자에게 다시 연결하도록 안내한다. 일시적인 네트워크 장애는 갱신 토큰을
삭제하지 않는다.

## 릴리스 전 1회 설정

Google Cloud Console의 `bring-fm` 프로젝트(프로젝트 번호 `864976295990`)에서
BRING CRM 전용 OAuth 클라이언트를 `데스크톱 앱` 유형으로 만든다. Web 유형은 임의
포트의 `127.0.0.1` loopback redirect를 허용하지 않으므로 사용할 수 없다.

발급된 공개 Client ID를 GitHub Actions 저장소 변수
`BRING_CRM_GOOGLE_DRIVE_CLIENT_ID`에 넣는다. Client secret은 저장하거나 앱에 포함하지
않는다. 릴리스 워크플로와 앱 실행 경로는 이 변수가 비었거나 Google Client ID 형식이
아니거나 `bring-fm` 프로젝트 번호로 시작하지 않으면 중단한다. `bring-fm-hj`를 포함한
다른 프로젝트의 Client ID로 우회하지 않는다.

OAuth 동의 화면을 `테스트` 상태로 두면 Drive 범위가 포함된 갱신 토큰도 7일 뒤
만료된다. 회사 Google Workspace 내부 앱으로 운영하거나, 외부 계정을 써야 한다면
Google 정책에 맞게 앱을 프로덕션 상태로 전환·검증해야 한다. 이 설정이 빠지면
업데이트와 무관하게 7일마다 재연결이 필요해진다.

로컬 확인은 현재 PowerShell 세션에 아래 환경 변수만 넣고 CRM을 실행한다.

```powershell
$env:BRING_CRM_GOOGLE_DRIVE_CLIENT_ID = "발급된-데스크톱-클라이언트-ID"
npm start
```

Client ID는 공개 식별자지만 계정·토큰·Client secret은 로그나 저장소에 남기지 않는다.

## 호환성

`bring-fm` Client ID가 포함된 암호화 연결 파일만 복원한다. Client ID가 없거나 다른
프로젝트에서 발급된 기존 연결은 안전하게 지우고 한 번 다시 연결하도록 안내한다.
재연결 뒤에는 `bring-fm` 갱신 토큰 형식으로 저장되어 업데이트 후에도 자동 복원된다.
