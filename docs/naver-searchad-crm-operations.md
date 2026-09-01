# 네이버 검색광고 CRM 지표 운영

## 구성

- 광고계정: `2575255`
- 수집 주기: 10분 (`Asia/Seoul`)
- Firebase 저장 위치: `crmCompany/marketingMetrics/naver`
- CRM 표시: 한눈에 보기 → 네이버 광고 지표
- 문의 전환: `crmCompany/marketingLeadInbox`의 `utmCampaign`·서비스 값과 캠페인 서비스 키를 연결

## 필요한 Firebase Secret

실제 값은 저장소, 문서, 로그에 기록하지 않는다.

```powershell
firebase functions:secrets:set NAVER_SEARCHAD_ACCESS_LICENSE --project bring-fm
firebase functions:secrets:set NAVER_SEARCHAD_SECRET_KEY --project bring-fm
firebase functions:secrets:set NAVER_SEARCHAD_CUSTOMER_ID --project bring-fm
```

`NAVER_SEARCHAD_CUSTOMER_ID`에는 `2575255`를 설정한다. 라이선스와 비밀키는 네이버 검색광고의 도구 → API 사용 관리에서 발급한다.

## 배포 전 확인

1. Functions 전체 테스트와 TypeScript 빌드를 통과시킨다.
2. Database Rules 테스트를 통과시킨다.
3. 세 비밀값을 Firebase Secret으로 등록한다.
4. 조직의 Functions 배포 승인 절차에 따라 `syncNaverMarketingMetrics`만 배포한다.
5. `crmCompany/marketingMetrics/naver/status/ok`가 `true`이고 `syncedAt`이 10분 이내인지 확인한다.
6. 같은 서울 날짜 기준으로 네이버 대시보드와 CRM의 노출·클릭·비용을 대조한 뒤 광고를 운영한다.

## 지표 해석과 안전장치

- 클릭 10건 미만은 항상 `표본 부족`으로 표시한다.
- CRM 제안은 유지·감액 검토·증액 검토·중지 검토·데이터 지연만 제공하며 광고 설정을 자동 변경하지 않는다.
- 잔액 10,000원 운영 중에는 자동충전을 켜지 않는다.
- API 데이터가 없거나 지연되면 CRM은 `API 연결 대기`를 표시한다.

## 장애 대응

- `AUTH_FAILED`(401/403): API 라이선스, 비밀키, 고객 ID 조합을 다시 확인한다.
- `RATE_LIMITED`(429): 다음 10분 주기까지 기다리고 중복 수동 실행을 멈춘다.
- `UPSTREAM_FAILED`(5xx): 네이버 장애 가능성이 있으므로 마지막 정상 스냅샷을 기준으로 판단하지 않는다.
- `BAD_REQUEST`(4xx): 캠페인 ID와 `/stats` 필수 파라미터를 확인한다.

네이버 공식 API의 요청 서명은 `timestamp.method.uri` 문자열을 HMAC-SHA256으로 처리한 Base64 값이며, 쿼리스트링은 서명 URI에 포함하지 않는다.
