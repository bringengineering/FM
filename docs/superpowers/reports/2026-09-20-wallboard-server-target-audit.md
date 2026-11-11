# CRM / TV 서버 대상 확인

## 확인 결과

- 현재 컴퓨터의 설치된 CRM: `bring-crm-desktop/resources/app.asar`, 버전 1.47.0.
- 설치된 메인 코드의 중계 서버: `bring-crm-ai-gateway.bringengineering1008.workers.dev`.
- 현재 프로세스·Windows 사용자·컴퓨터 범위의 `BRING_CRM_AI_GATEWAY_URL` 재정의 없음.
- 실행 중인 BRING CRM 프로세스는 이번 조회에서 발견되지 않음. 따라서 실제 요청 추적이 아닌 설치 파일 및 환경 설정 근거임.
- 개발 브랜치 CRM과 TV 전용 클라이언트도 동일한 `bringengineering1008.workers.dev` 서버를 가리킴. 주소 변경은 필요하지 않음.

## Cloudflare 계정 구분

- 현재 배포 토큰으로 확인되는 계정 이름: `Rancemo858@naver.com's Account`.
- 이 계정의 workers.dev 하위 도메인은 `bringengineering-crm`.
- 이 계정에도 이름이 같은 `bring-crm-ai-gateway`가 존재하지만 설치 CRM의 기본 서버 주소와는 다름.
- 두 서버의 공개 health 응답 모두 200이며, 식별 버전은 각각 `2026-08-31-v1`(bringengineering-crm), `2026-09-08-v7`(bringengineering1008).
- health 응답은 로그인/업무 저장 성공이나 전체 기능 정상의 증거는 아님.

## 결정

설치 CRM이 사용하는 서버를 보존한다. 오래된 다른 서버로 임의 전환하거나 그 서버를 운영 대상으로 오인해 덮어쓰지 않는다. TV 코드의 서버 주소도 변경하지 않는다.

실제 배포를 위해 `bringengineering1008.workers.dev` 서버를 관리하는 Cloudflare 계정의 정상 권한 연결이 필요하다. 현재 토큰의 권한 범위를 확장하거나 다른 인증정보를 추출하지 않았다. 운영 변경, 자원 생성, 배포 없음.

## 회사 계정 로그인 후 재확인

- 브라우저에서 `Bringengineering1008@gmail.com's Account`와 `bring-crm-ai-gateway.bringengineering1008.workers.dev` 상세 화면을 확인했다.
- 회사 계정 ID: `3c3bcd08bb6ed3a7a8f98c292386c327`.
- 기존 Wrangler OAuth 로그인도 회사 이메일에 연결되어 있다. 별도 계정 환경변수가 우선 적용된 것이 최초 계정 혼선의 원인이었다. 전역 환경변수·인증 파일은 변경하지 않았다.
- 회사 요금제 화면은 Free / Current plan이며 SQLite Durable Objects 무료 할당량이 표시된다. 유료 요금제로 변경하지 않았다.
- 로컬 `wrangler.toml`에 이 계정 ID를 명시했다. 잘못된 다른 계정으로 같은 이름의 Worker를 배포하지 않도록 대상이 고정된다.
- 현재 OAuth가 최신 Wrangler의 전체 권한을 갖지는 않지만, 불필요한 권한 확대는 하지 않는다. 필요한 실제 작업에서 권한 오류가 발생하면 중단하고 확인한다.
- 이 재확인은 서버 배포 완료를 의미하지 않는다. 실제 운영 설정 대조와 배포·TV 검증은 남아 있다.
