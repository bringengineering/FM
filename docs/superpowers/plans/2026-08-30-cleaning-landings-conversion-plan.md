# BRING CARE 청소 광고 랜딩 통합 최적화 구현 계획

1. `landing-page.test.tsx`에 두 페이지의 전용 시각 허브, 중간 CTA, 입주청소 4단계 절차를 요구하는 실패 테스트를 추가한다.
2. `StairCleaningLanding.tsx`에 공용부 작업범위 요약 허브와 중간 견적 CTA를 추가한다.
3. `MoveInCleaningLanding.tsx`에 입주청소 범위 요약 허브, 4단계 절차, 중간 견적 CTA를 추가한다.
4. `stair-cleaning.css`에 공통 광고형 히어로, 허브, 입체 카드, 반응형 스타일을 추가한다.
5. 대상 테스트를 통과시킨 뒤 전체 랜딩 테스트와 빌드를 실행한다.
6. PC·모바일 스크린샷으로 잘림과 시각 계층을 검수한다.
7. Firebase 정적 파일을 생성하고 Hosting만 배포한다.
8. 공개 URL 두 개에서 신규 마커와 HTTP 200을 확인하고 GitHub에 푸시한다.
