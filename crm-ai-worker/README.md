# BRING CRM AI Gateway

BRING CRM과 Groq Cloud 사이에서 Firebase 직원 인증, 개인정보 마스킹, 무료 사용량 제한을 수행하는 별도 Cloudflare Worker입니다. 기존 카카오 민원 Worker와 독립적으로 배포합니다.

## 보안 경계

- `GROQ_API_KEY`는 Cloudflare Secret으로만 저장합니다.
- 키 값을 소스, `.env`, GitHub Actions 변수, CRM EXE에 넣지 않습니다.
- Firebase ID 토큰은 Worker에서 검증하며 Groq에 전달하지 않습니다.
- 상담 원문은 저장하거나 로그에 남기지 않습니다.
- 직원 이메일은 `CRM_ALLOWED_EMAILS`의 명시적 허용 목록과 대조합니다.
- AI 응답은 초안이며 CRM 데이터를 자동으로 변경하지 않습니다.

## CRM 고객 문서 발송

견적서와 작업 결과보고서는 전용 KV `DOCUMENT_DELIVERY`에 최대 14일 동안 저장되고, 추측하기 어려운 만료 링크로만 열립니다. 카카오 검수 완료 전에는 `DOCUMENT_DELIVERY_ENABLED=false`, `KAKAO_DOCUMENT_TEMPLATES_APPROVED=false`를 유지하므로 실제 발송이 차단됩니다.

검수 완료 후 Worker Secret에 `NCP_ACCESS_KEY`, `NCP_SECRET_KEY`를 등록하고, 일반 변수에 `NCP_BIZ_MESSAGE_SERVICE_ID`, `KAKAO_CHANNEL_ID`, `NCP_SENS_SERVICE_ID`, `NCP_SENS_FROM`을 등록합니다. 이후 두 승인 플래그를 `true`로 바꿔 배포합니다. 견적서는 `BRINGCUSTOMERQUOTEV1`, 결과보고서는 `BRINGCOMPLETIONREPORTV1`만 사용하며 CRM이 임의 템플릿 코드를 지정할 수 없습니다.

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

Firebase Web API 키는 비밀 자격증명이 아니지만 운영 프로젝트를 명시하는 구성값이므로 Cloudflare 변수로 등록합니다. Groq 키는 화면이나 명령 인수에 쓰지 않고 프롬프트에서 직접 입력합니다.

```powershell
npx wrangler secret put FIREBASE_WEB_API_KEY
npx wrangler secret put GROQ_API_KEY
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
