# 브링케어 블로그 자동화 장애 원장

## 텔레그램 전달 상태

각 이벤트에는 비밀정보 없이 아래 상태 중 하나만 기록합니다.

- `telegram_delivery: sent` — 전송 완료
- `telegram_delivery: suppressed` — 같은 상태의 24시간 내 중복 알림 생략
- `telegram_delivery: failed` — 전송 실패, 원고와 자산은 보존
- `telegram_delivery: not_configured` — 로컬 텔레그램 설정이 아직 없음

토큰, Chat ID, 승인 URL의 쿼리 문자열, 암호화 토큰 바이트는 이 원장에 기록하지 않습니다.

## 열린 장애

없음

## 해결된 장애

없음
