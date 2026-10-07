# BRING CRM AI Gateway

BRING CRM의 AI 요청을 Firebase 직원 인증과 개인정보 마스킹 뒤 처리하는 별도 Cloudflare Worker입니다. 일반 AI 기능은 Groq를 유지하고, 작업 결과보고서와 건물 월간보고서만 Gemini API로 보냅니다. 기존 카카오 민원 Worker와 독립적으로 배포합니다.

## 보안 경계

- `GROQ_API_KEY`는 Cloudflare Secret으로만 저장합니다.
- `GEMINI_API_KEY`도 Cloudflare Secret으로만 저장합니다. Gemini는 `completion_report`와 `building_monthly_report`에만 사용합니다.
- 키 값을 소스, `.env`, GitHub Actions 변수, CRM EXE에 넣지 않습니다.
- Firebase ID 토큰은 Worker에서 검증하며 Groq나 Gemini에 전달하지 않습니다.
- 상담 원문은 저장하거나 로그에 남기지 않습니다.
- 직원 이메일은 `CRM_ALLOWED_EMAILS`의 명시적 허용 목록과 대조합니다.
- AI 응답은 초안이며 CRM 데이터를 자동으로 변경하지 않습니다.

보고서와 입주청소 사진 구역 분류의 기본 모델은 `GEMINI_REPORT_MODEL = "gemini-3.5-flash-lite"`입니다. 모델명은 비밀값이 아니며 API 요청에서 서버가 지정합니다. 일반 AI와 음성 전사는 기존 Groq 설정을 계속 사용합니다.

## 로컬 Gemini 미리보기

이 경로는 로컬 Worker에만 키를 읽히며 Cloudflare 운영 Worker나 CRM 정식 배포를 변경하지 않습니다.

1. `.dev.vars.example`을 `.dev.vars`로 복사합니다. `.dev.vars`는 Git에서 제외됩니다.
2. `.dev.vars`에 직접 `GEMINI_API_KEY`와 로컬 인증용 `FIREBASE_WEB_API_KEY`를 입력합니다. 키를 채팅, 코드, CRM 앱 설정에 넣지 마세요.
3. 이 폴더에서 `npm run dev`를 실행해 로컬 Worker를 `127.0.0.1:8787`로 실행합니다.
4. 별도 PowerShell에서 `desktop-crm` 폴더로 이동한 뒤 `$env:BRING_CRM_LOCAL_GEMINI_REPORTS = "1"; npm start`를 실행합니다.

개발 모드에서만 작업 결과보고서와 건물 월간보고서 요청이 로컬 Worker로 갑니다. 패키징된 앱은 이 HTTP 미리보기 경로를 허용하지 않습니다. 두 보고서 생성은 Gemini 사용량을 소비할 수 있습니다.

## 작업 사진 구역 분류

`POST /v1/photo-classify`는 인증된 CRM 사용자가 선택한 입주청소 사진을 Gemini로 구역별 분류합니다. Electron 메인 프로세스가 최대 120KB JPEG 축소본으로 다시 인코딩해 메타데이터를 제거하며, 요청당 최대 30장을 받습니다. Gateway는 6장씩 최대 2개 요청을 동시에 처리하며 고정 HTTPS 주소·리디렉션 거부·전체 60초 제한·응답 128KB 제한을 적용합니다. Gemini에는 임시 사진 번호만 보내며 Drive ID·파일명·링크를 전달하지 않습니다. 단, 사진 안에 보이는 개인정보는 포함될 수 있으므로 사용자가 선택한 사진만 전송합니다. 결과는 기존 category 열거형으로 제한하고 모델 점수 75 미만은 `review`로 남깁니다. 점수는 정확도를 보장하는 확률이 아니며 UI에 정확도처럼 표시하지 않습니다. 자유 서술 응답은 반환하지 않습니다. 축소본과 분류 결과를 Gateway 저장소에 기록하지 않습니다.

CRM은 사진 가져오기 후 자동분류하며 최대 100장을 30장 이하 요청으로 순차 처리합니다. 먼저 `space`(공간)와 `target`(대상)을 별도로 분류하고, 같은 공간·대상의 사진을 다시 모아 `mode: "compare"`로 전·후 짝을 추천합니다. 비교는 요청당 최대 30장으로 처리하며 장소 일치·변화 판단 점수가 각각 85 이상이고 먼지/오염/잔류물 감소 근거가 있는 짝만 반환합니다. 점수는 확률이 아니며 정확도를 보장하지 않습니다. 깨끗해 보인다는 이유만으로 작업 후를 지정하지 않습니다. 한 그룹이 30장을 넘으면 나뉜 묶음 사이의 짝은 사용자가 확인합니다.

작업 사진 분류 시 작은 Drive 미리보기는 선택한 원본을 제한적으로 다운로드해 보완하고, 비교는 원본에서 축소본을 만듭니다. 로컬에서 최대 긴 변 1024px부터 크기를 줄여 120KB 이하 JPEG로 재인코딩하며 Gemini에 원본이나 EXIF를 보내지 않습니다. 기존 파일·폴더의 전후 표기와 파일명 시간 힌트를 보존하며 Drive 업로드 시각은 쓰지 않습니다. AI 추천은 사용자가 확인한 사진만 초안에 적용합니다. 실패·불확실한 사진은 수동 목록에 유지하고 전후 바꾸기, 짝 해제/지정, 여러 장 일괄 지정이 가능합니다. 재분류 시 수동 선택을 보존하고 반복 적용 시 중복을 방지하며, 기존 메모·완료 상태·저장된 보고서는 자동 변경하지 않습니다. 일반/계단 등 다른 종류는 기존 수동 구역 분류와 전·후 선택을 사용합니다.

배포 검증: Worker/클라이언트 계약 및 순수 상태 테스트와 `desktop-crm/scripts/check-work-report-photo-review.cjs`의 실제 렌더러 합성 사진 시나리오를 실행합니다. 실고객 사진으로 정확도를 측정한 결과는 아닙니다. 기존 클라이언트는 `mode` 없이 기존 `category` 응답을 계속 사용합니다. 장애 시 기존 코드로 되돌리는 새 정식 버전을 예약해 배포하고, 사용자 저장 보고서나 Firebase 규칙은 변경하지 않습니다.

## CRM 고객 문서 발송

견적서, 작업 결과보고서, 건물 월간보고서는 전용 KV `DOCUMENT_DELIVERY`에 최대 14일 동안 저장되고, 추측하기 어려운 만료 링크로만 열립니다. 전송 및 상태 조회는 Firebase 인증에 더해 Worker의 `CRM_ADMIN_EMAILS` 관리자 허용 목록을 통과해야 합니다. 카카오 검수 완료 전에는 `DOCUMENT_DELIVERY_ENABLED=false`, `KAKAO_DOCUMENT_TEMPLATES_APPROVED=false`, `KAKAO_MONTHLY_REPORT_TEMPLATE_APPROVED=false`를 유지하므로 실제 발송이 차단됩니다.

검수 완료 후 Worker Secret에 `NCP_ACCESS_KEY`, `NCP_SECRET_KEY`를 등록하고, 일반 변수에 `NCP_BIZ_MESSAGE_SERVICE_ID`, `KAKAO_CHANNEL_ID`, `NCP_SENS_SERVICE_ID`, `NCP_SENS_FROM`을 등록합니다. 견적서와 작업 결과보고서 템플릿 승인이 확인된 뒤 `KAKAO_DOCUMENT_TEMPLATES_APPROVED=true`, 월간보고서 템플릿 승인이 확인된 뒤 `KAKAO_MONTHLY_REPORT_TEMPLATE_APPROVED=true`로 각각 설정합니다. 각 전용 템플릿이 승인되기 전에는 해당 문서 발송 capability가 비활성화되고 Worker가 발송을 거부합니다. 견적서는 `BRINGCUSTOMERQUOTEV1`, 결과보고서는 `BRINGCOMPLETIONREPORTV1`, 월간보고서는 `BRINGMONTHLYREPORTV1`만 사용하며 CRM이 임의 템플릿 코드를 지정할 수 없습니다.

월간보고서 템플릿 승인 요청 본문은 Worker의 `alimTalkContent()`가 만드는 문구와 버튼명(`월간 보고서 확인`)을 그대로 사용해야 합니다. NCP 콘솔에서 승인 상태를 확인하기 전에는 승인 플래그를 켜지 마세요.

## 건물 월간보고서 사진 선택

`POST /v1/monthly-report-photo-select`는 CRM 메인 프로세스가 선택한 Drive 폴더 안의 JPEG 축소본(최대 24장, 각 120KB 이하)만 Gemini에 전달합니다. Gemini는 보고서 업무와 관련된 사진을 최대 12장 골라 ID와 짧은 설명만 반환합니다. 주소·Drive 링크·계정 토큰은 보내지 않고, 사진 축소본은 저장하지 않습니다.

Gemini API 키는 Cloudflare Worker Secret `GEMINI_API_KEY`로만 등록합니다. 키를 코드, `wrangler.toml`, `.env`, CRM 설치 파일 또는 채팅에 입력하지 마세요. 현재 안정 모델 기본값은 `gemini-3.8-flash`이며 필요할 때만 Worker 변수 `GEMINI_VISION_MODEL`로 변경합니다. Secret이 없으면 사진 선택 요청은 `GEMINI_NOT_CONFIGURED`로 fail closed 합니다.

```powershell
npx wrangler secret put GEMINI_API_KEY
npm test
npm run deploy
```

## 최초 배포

```powershell
npm install
npx wrangler whoami
npx wrangler kv namespace create AI_USAGE
```

마지막 명령이 출력한 namespace ID를 `wrangler.toml`에 다음 형태로 추가합니다.

```toml
[[kv_namespaces]]
binding = "AI_USAGE"
id = "Cloudflare가 출력한 실제 namespace ID"
```

Firebase Web API 키는 비밀 자격증명이 아니지만 운영 프로젝트를 명시하는 구성값이므로 Cloudflare 변수로 등록합니다. Provider API 키는 화면이나 명령 인수에 쓰지 않고 Wrangler Secret 입력 프롬프트에서 직접 입력합니다.

```powershell
npx wrangler secret put FIREBASE_WEB_API_KEY
npx wrangler secret put GROQ_API_KEY
npx wrangler secret put GEMINI_API_KEY
npm test
npm run deploy
```

첫 배포는 `AI_ENABLED = "false"`로 수행합니다. `/health`와 인증 차단을 확인한 후에만 `true`로 바꿔 다시 배포합니다.

## 안전한 점검 순서

1. `GET /health`가 `200`과 `enabled: false`를 반환하는지 확인합니다.
2. 인증 없는 `POST /v1/assist`가 AI를 호출하지 않는지 확인합니다.
3. 기능을 활성화하고 비민감 테스트 문장으로 정상 응답을 확인합니다.
4. 합성 전화번호·이메일·계좌번호·상세주소가 Groq 요청 전에 대체되는지 확인합니다.
5. 대표 계정과 현진님 계정만 허용되고 미등록 계정은 거부되는지 확인합니다.

Cloudflare Rate Limiting binding은 직원 UID별 분당 20회를 허용합니다. KV의 회사 일일 집계는 무료 한도 보호용이며 정확한 회계 원장으로 사용하지 않습니다.
