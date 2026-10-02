# BRING Care Kakao intake Worker

카카오 챗봇의 스킬 요청을 기존 Google Apps Script 웹 앱으로 전달하는
리다이렉트 없는 HTTPS 중계 Worker입니다.

## 운영 주소

- 상태 확인: `https://bring-care-kakao-intake.bringengineering1008.workers.dev/health`
- 카카오 스킬: `https://bring-care-kakao-intake.bringengineering1008.workers.dev/kakao/intake`

## 보안

Apps Script 스킬 토큰이 포함된 전체 URL은 Cloudflare Secret
`APPS_SCRIPT_SKILL_URL`에만 저장합니다. GitHub 저장소, Worker 코드 및 로그에는
기록하지 않습니다.

## 검증 및 배포

```powershell
node --test test/*.test.js
wrangler secret put APPS_SCRIPT_SKILL_URL
wrangler deploy
```

Apps Script 쪽에서 `KAKAO_CHATBOT_BOT_ID`를 운영 봇 ID로 설정하고,
연결 테스트가 완료된 후 `KAKAO_CHATBOT_INTAKE_ENABLED=true`로 전환해야 실제
대화형 접수가 시작됩니다.
