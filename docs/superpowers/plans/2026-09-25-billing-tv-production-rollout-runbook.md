# 청구 장부·TV 매출 운영 출시 실행서

상태: 실행 준비 완료, 운영 배포 미승인. 이 문서는 승인 후 사용할 순서와 검증 명령을 고정한다. 명령 일부만 골라 실행하거나 순서를 바꾸지 않는다.

## 출시 전 불변 조건

- 대상 Firebase 프로젝트는 `bring-fm`, DB 인스턴스는 `bring-fm-default-rtdb`다.
- 대상 Cloudflare 계정은 `3c3bcd08bb6ed3a7a8f98c292386c327`다.
- 작업 브랜치와 PR #134의 CI가 모두 성공하고 작업 폴더가 깨끗해야 한다.
- `%LOCALAPPDATA%\BRING CRM\release-backups\billing-ledger`의 최신 백업과 감사 결과를 보존한다.
- `release/firebase-targets.json`의 Functions 배포 금지 정책은 소유자가 명시적으로 승인하기 전까지 우회하지 않는다.
- TV 공개 스냅샷에는 합계만 넣고 계약 ID·거래번호·증빙·UID·반려 사유를 넣지 않는다.

## 1. 배포 직전 읽기 전용 확인

```powershell
git status --short --branch
gh pr checks 134
firebase functions:list --project bring-fm
$env:CLOUDFLARE_API_TOKEN=$null
.\node_modules\.bin\wrangler.cmd whoami
```

아래 조건 중 하나라도 맞지 않으면 중단한다.

- Git 작업 폴더가 깨끗하지 않음
- PR 검사가 실패 또는 진행 중
- Firebase 프로젝트가 `bring-fm`이 아님
- Cloudflare 계정 ID가 회사 계정과 다름
- 운영 장부 백업·감사 결과를 찾을 수 없음

## 2. Function 먼저 배포

소유자가 `functionsDeploymentAllowed: false` 정책 변경과 `commitBillingLedgerMutation` 출시를 별도로 승인한 경우에만 실행한다. 승인 전에는 아래 명령을 실행하지 않는다.

```powershell
npm --prefix functions run build
pnpm --dir company-site exec firebase --config ../firebase.json --project bring-fm deploy --only functions:field-platform:commitBillingLedgerMutation --non-interactive
```

배포 후 인증정보 없이 POST하여 정확히 HTTP 401과 `billing_auth_required`만 나오는지 확인한다. 404·5xx·HTML 응답이면 다음 단계로 가지 않는다.

```powershell
$probe = Invoke-WebRequest -SkipHttpErrorCheck -Method Post -ContentType 'application/json' -Body '{}' -Uri 'https://asia-northeast3-bring-fm.cloudfunctions.net/commitBillingLedgerMutation'
$probe.StatusCode
$probe.Content
```

## 3. 제한된 계정 저장 검증

담당자 계정으로 초안 한 건을 만들고 관리자 계정으로 확정한다. 동일 계약·월 중복 청구, 같은 거래번호 중복 입금, 오래된 버전 저장이 모두 거부되는지 확인한다. 실제 고객 금액을 시험값으로 만들지 않으며, 승인된 테스트 계약을 사용한다.

검증이 끝나기 전에는 신규 CRM과 규칙을 배포하지 않는다.

## 4. 신규 CRM과 규칙

신규 CRM에서 Function 호출 URL, 로그인, 충돌 후 최신 장부 재조회, 권한 오류 문구를 확인한다. 그 다음에만 `database.rules.json`을 배포한다. 규칙 워크플로는 장부 Function이 401 `billing_auth_required`로 응답하지 않으면 자동으로 중단된다.

규칙 적용 후 다음을 확인한다.

- 담당자: 초안 생성·수정 가능, 확정·취소 불가
- 관리자: 확정·반려·취소 가능
- 조회 전용·마케팅 계정: 장부 변경 불가
- 구버전 직접 쓰기: 명확히 실패
- 일반 계약 조회: 계속 가능

## 5. Worker 배포

로컬 `wrangler.toml`은 비승인 환경에서 자동 갱신을 막기 위해 `WALLBOARD_SCHEDULED_REFRESH_ENABLED = "false"`다. 운영 Worker는 이미 자동 갱신을 사용하므로, 승인된 운영 배포에서는 아래처럼 회사 계정을 확인하고 활성값을 명시적으로 덮어써야 한다.

```powershell
Set-Location crm-ai-worker
$env:CLOUDFLARE_API_TOKEN=$null
.\node_modules\.bin\wrangler.cmd whoami
.\node_modules\.bin\wrangler.cmd deploy --dry-run --keep-vars --var WALLBOARD_SCHEDULED_REFRESH_ENABLED:true
.\node_modules\.bin\wrangler.cmd deploy --keep-vars --var WALLBOARD_SCHEDULED_REFRESH_ENABLED:true
```

`--keep-vars`를 빼거나 회사 계정 확인 없이 배포하지 않는다. 시크릿 값은 명령행·로그·문서에 출력하지 않는다.

## 6. 실제 TV 판정

담당자 PC → 관리자 PC → TV 순서로 확인한다.

1. 담당자가 청구 초안을 저장한다. TV 금액은 변하지 않고 확인 대기 건수만 반영되는지 본다.
2. 관리자가 청구를 확정한다. TV 청구액이 변경되는 시간을 기록한다.
3. 부분입금 두 건을 각각 확정한다. 실입금액과 미수금이 합계와 일치하는지 본다.
4. CRM PC를 종료한 뒤 5분 주기 서버 갱신이 계속되는지 확인한다.
5. TV 네트워크를 잠시 끊었다 복구해 마지막 정상 게시본과 게시 시각이 유지되는지 확인한다.
6. TV 응답과 브라우저 개발자 도구에서 계약·거래번호·증빙·UID가 노출되지 않는지 확인한다.

## 7. 중단·롤백 조건

다음 중 하나라도 발생하면 신규 입력을 중단한다.

- Function이 401 인증 오류 대신 404·5xx 또는 HTML을 반환
- 규칙 적용 후 정상 계정의 장부 읽기 실패
- 중복 청구·중복 거래번호가 저장됨
- 초안이 TV 금액으로 집계됨
- TV 공개 자료에 고객·계약·은행·증빙 정보가 포함됨
- 기존 TV 게시본이 빈 화면 또는 0원으로 덮임

롤백할 때 장부 원본은 삭제하지 않는다. 규칙은 직전 정상 커밋으로 워크플로를 재실행하고, Worker는 직전 배포 버전으로 되돌린다. Function을 즉시 삭제하지 말고 신규 호출을 중단한 뒤 장부 변경분을 백업·대조한다.

## 완료 증빙

- Function 배포 시각과 버전
- 규칙 배포 커밋
- Worker 배포 버전
- 담당자·관리자 테스트 결과
- 저장부터 TV 반영까지 걸린 시간
- 공개 스냅샷 개인정보 검사 결과
- 실패 또는 롤백 여부

위 증빙이 모두 있어야 운영 출시 완료로 판정한다.
