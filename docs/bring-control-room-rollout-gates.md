# BRING 운영보드·프로젝트·TV 출시 관문

이 문서는 코드 검토와 운영 반영을 구분한다. 검토 요청이 통과해도 직원 CRM이나 실제 TV에 자동 반영됐다는 뜻은 아니다. 배포 승인 전에는 운영 환경을 변경하지 않는다.

## 대상과 현재 경계

- 운영 CRM 소스 브랜치: `codex/bring-field-platform`. `crm-release.yml`과 `crm-rules-deploy.yml`은 이 브랜치의 push를 기준으로 실행된다.
- 프로젝트 관리부터 TV 주간보고까지의 변경은 순서가 있는 검토 요청에 있다. 현재 최상단 검토 요청은 [#130](https://github.com/bringengineering/FM/pull/130)이며, 기초 변경은 #124부터 차례로 이어진다. 각 검토 요청의 base와 CI를 병합 직전에 다시 확인한다.
- Worker 목표 계정은 `3c3bcd08bb6ed3a7a8f98c292386c327`, 이름은 `bring-crm-ai-gateway`, 공개 TV 주소는 `https://bring-crm-ai-gateway.bringengineering1008.workers.dev/tv`이다. `wrangler.toml`의 계정 ID를 다른 계정에 맞춰 바꾸지 않는다.
- 현재 통합 브랜치의 `WALLBOARD_SCHEDULED_REFRESH_ENABLED`는 `false`다. 5분 cron 선언만으로 서버 단독 자동 갱신이 켜진 것은 아니다.
- TV 설치본 배포는 `tv-release.yml`의 별도 `bring-tv-production` 승인 절차다. 자동 CRM 릴리스와 혼동하지 않는다.

## 출시 순서와 증거

| 관문 | 실행 전 확인 | 통과 증거 |
| --- | --- | --- |
| 1. 코드 검토 | #124부터 #130까지 base 순서, 변경 범위, CI, 운영 데이터 보호 | 각 검토 요청 승인 및 필수 검사 통과 |
| 2. 운영 소스 반영 | 배포 대상으로 합의한 정확한 commit이 `codex/bring-field-platform`에 포함되는지 | 브랜치 SHA와 병합 기록 |
| 3. Firebase 규칙 | 변경된 규칙이 있으면 에뮬레이터 검사를 먼저 통과 | `crm-rules-deploy.yml`의 대상 SHA와 성공 로그. 규칙 배포 경로가 두 개(`crm-rules-deploy.yml`, `crm-release.yml`)이므로 실행 순서와 대상 SHA가 일치하는지 확인 |
| 4. CRM 설치본 | 서명·자산 검증·업데이트 채널 확인 | `crm-release.yml` 성공, 실제 직원 PC의 설치 버전과 핵심 화면 확인 |
| 5. Worker | 회사 Cloudflare 계정 접근 확인. Secret 값은 채팅·로그에 남기지 않음 | 목표 account ID 확인, dry-run, 실제 배포 버전, `/health` 및 인증 없는 요청 차단 확인 |
| 6. TV 설치본/웹 | 사용 중인 TV 형태(웹 또는 Windows 설치본), 실제 버전과 등록 상태 확인 | 화면의 빌드 버전, 정상 등록, 장면 순환·새로고침 장애 없음 |
| 7. 두 기기 현장 검증 | 담당자 CRM PC와 TV PC를 분리하고 관리자 PC를 종료해도 표시되는지 확인 | 업무지시 30회 변경·승인 저장의 CRM→서버→TV 반영 시간 기록, 오류·중복·지연 목록 |

## 배포 차단 조건

- `wrangler whoami`가 회사 계정을 보여주지 않거나 대상 account ID를 확인할 수 없으면 Worker 배포를 중단한다. 다른 계정의 토큰을 재사용하거나 계정 설정을 임의 변경하지 않는다.
- 테스트 통과만으로 실제 두 기기 반영이 증명되지는 않는다. 마지막 현장 검증 전에는 'TV 실시간 운영 완료'라고 표시하지 않는다.
- 목표·매출·조직도는 회사의 승인된 원천과 공개 범위가 정해지기 전까지 실제값처럼 채우지 않는다. 빈 값은 '연결 대기'로 표시한다.
- Gemini 요약은 원자료·승인자·생성시각을 남기고 초안으로 취급한다. AI가 업무 완료율이나 매출 수치를 확정하지 않는다.

## 두 기기 지연 측정

`desktop-crm/scripts/wallboard-field-acceptance.js`는 현장 관측값 30건 이상의 저장 성공→서버 게시→TV 수신 지연을 집계한다. 입력 JSON은 배열이며 각 행에는 업무 내용 대신 익명 시험 ID(`id`)와 Unix 밀리초 시각 `savedAt`, `publishedAt`, `receivedAt`만 넣는다. 사용 예: `node desktop-crm/scripts/wallboard-field-acceptance.js observations.json`.

측정 전에 PC·TV 시계를 동기화하고 오차를 기록한다. 서버 게시 버전과 TV 화면의 동일 버전을 짝지어야 하며, 중복 ID·누락 시각·순서가 뒤바뀐 기록은 거부한다. 출력의 `latencyTargetMet`는 **기록된 값의 10초 목표만** 판정한다. `evidenceStatus: TIMING_ONLY`는 관리자 PC 종료, 실제 직원 계정, 승인 TV, 시계 동기화, 개인정보 비노출, 장애 복구가 검증됐다는 뜻이 아니다. 이 조건과 원본 증거를 사람이 별도로 확인하기 전에는 출시 관문 7을 완료로 표시하지 않는다.

## 장애와 되돌리기

- Firebase 규칙 오류는 `crm-rules-deploy.yml`의 `rules_ref`에 검증된 이전 SHA를 지정하는 절차를 사용한다. 현재 데이터 자체를 삭제하거나 초기화하지 않는다.
- TV Worker 장애 시 `WALLBOARD_ENABLED=false`인 호환 버전을 검토한다. 기존 Durable Object 클래스·바인딩·등록정보를 삭제하지 않는다.
- 데스크톱/TV 설치본은 각각 서명된 릴리스 채널의 이전 안정 버전과 영향을 확인한다. 버전 태그를 강제로 이동하거나 이미 사용한 버전을 재사용하지 않는다.

## 아직 미완료인 항목

운영 반영 승인과 회사 Cloudflare 자격 확인, 실제 TV 기기 등록·자동 갱신, 두 기기 30회 측정, 회사가 확정한 비전·조직·목표·매출 원천·Gemini 연결 검증은 별개 작업으로 남아 있다. 이 항목을 테스트 통과나 검토 요청 생성으로 대체하지 않는다.
