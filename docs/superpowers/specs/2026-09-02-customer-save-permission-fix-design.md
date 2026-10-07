# 고객 저장 Permission denied 수정 설계

## 문제

고객 기본정보 폼은 일반 공용 저장 경로를 사용하지만, 제출할 때 `marketing` 객체도 다시 생성한다. 마케팅 객체에는 전용 CAS 저장 API가 관리하는 버전 메타데이터가 있으며 Firebase Rules는 일반 고객 필드 저장에서 `marketing` 변경을 금지한다. 그 결과 고객 기본정보만 수정해도 전체 PATCH가 `Permission denied`로 거부된다.

## 결정

- 고객 기본정보 폼은 고객 기본·연락·메모·건물 연결만 수정한다.
- `customerFromForm`은 기존 `customer.marketing` 값을 변경하지 않는다.
- 고객 기본정보 모달에서는 마케팅 입력 필드를 제거해 저장되지 않는 입력을 노출하지 않는다.
- 마케팅 유입 정보는 기존 `customerMarketingForm`과 전용 `updateMarketingAttribution` API만 사용한다.
- Firebase Rules는 완화하지 않는다.

## 오류 처리와 검증

- 서버 저장 성공 전에는 기존처럼 모달을 닫지 않는다.
- 회귀 테스트는 고객 기본 폼이 마케팅을 파싱·대입하지 않고 마케팅 입력 UI도 포함하지 않는지 확인한다.
- 전체 데스크톱 테스트, 스모크 실행, Windows 빌드를 수행한다.
- 운영 배포 후 실제 CRM에서 동일 고객의 기본정보 저장을 재시도해 `Permission denied`가 사라지고 서버 연결 상태가 복구되는지 확인한다.
