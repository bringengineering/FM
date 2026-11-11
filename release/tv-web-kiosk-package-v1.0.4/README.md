# BRING TV 운영보드 CMD 전용 설치판 v1.0.4

Windows TV 컴퓨터에서 회사 운영보드를 자동 실행하도록 등록하는 고객용 패키지입니다.

## 동작

- 현재 사용자 시작프로그램에 `BRING-TV-자동실행.cmd`만 복사합니다.
- Edge 또는 Chrome을 찾아 키오스크 모드로 실행합니다.
- `%LOCALAPPDATA%\BRING-TV\BrowserProfile`을 유지해 등록정보를 보존합니다.
- 고정 주소 `https://bring-crm-ai-gateway.bringengineering1008.workers.dev/tv`만 엽니다.

## 보안 범위

- 관리자 권한을 요구하지 않습니다.
- 비밀번호, 인증코드, API 키를 저장하지 않습니다.
- CRM 데이터와 다른 시작프로그램을 변경하지 않습니다.
- 삭제 파일은 BRING TV 시작프로그램 항목만 제거합니다.

## 구성

- `BRING-TV-설치.cmd`: 자동실행 등록 및 즉시 실행
- `BRING-TV-자동실행.cmd`: 브라우저 탐색 및 운영보드 실행
- `BRING-TV-삭제.cmd`: 자동실행 항목 제거
- `사용방법.txt`: 사용자 설치 안내
- `BRING-TV-설치복구-프롬프트.txt`: 안전한 오류 진단 요청문
