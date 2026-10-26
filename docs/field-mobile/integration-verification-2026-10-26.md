# 현장노트 연동 검증 — 2026-10-26

확인: 한국시간 20:23~20:29. 대상: `codex/field-mobile-design-20261026`의 모바일 개발 기반과 현재 `bring-fm` 서비스 메타데이터.

**판정: 로컬 구성요소 통합 시험은 통과했다. 새 모바일 앱의 실제 직원 로그인 → 현장 조회 → Drive 업로드 → PDF·CRM 보관 → 알림톡 발송 연결은 아직 구현·검증 전이다.**

## 운영 상태에서 직접 확인한 것

| 확인 | 결과 | 확인 범위의 한계 |
|---|---|---|
| Firebase 앱 목록 | 기존 웹 앱 1개. Android/iOS 앱 없음 | native 로그인·App Check 검증을 실행할 등록 기반이 없음 |
| Firebase 함수 목록 | 총 42개 ACTIVE, `crmDriveOAuth`와 기존 field 함수 포함. 모바일용 이름의 새 함수 없음 | 함수 이름만으로 모든 서비스의 기능을 단정하지 않음. 새 경로 부재는 아래 소스 검사와 함께 판단 |
| Drive OAuth broker 검사 | 배포·desktop client 설정 준비 표시·비인증 401 거부 통과 | 직원의 OAuth 연결, 파일 읽기·쓰기, 회사 Drive 폴더 권한을 검증한 것은 아님 |
| CRM AI 게이트웨이 `/health` | HTTP 200, `ok: true`, 서비스명 일치 | PDF 생성·템플릿 승인·알림톡 전달 성공을 뜻하지 않음 |
| Worker 발송 설정 읽기 | 현재 실행 환경에 전용 인증 값이 없어 미실행 | 비밀 값을 다른 저장소에서 수집하거나 공급자 승인 상태를 추측하지 않음 |

실행한 검사는 Firebase CLI의 `apps:list`, `functions:list`, 기존 `desktop-crm/scripts/release/check-drive-broker.js`, 게이트웨이 GET health다. Drive broker 검사는 인증 없는 빈 요청의 거부를 확인하며 파일이나 연결 상태를 바꾸지 않는다. 고객 레코드·직원 개인정보·문서 URL·인증 값을 보고서에 수집하지 않았다.

`release/firebase-targets.json`은 기존 field 함수들을 archived로 분류하지만 운영 목록에는 해당 함수들이 ACTIVE로 존재한다. **archived는 운영에서 제거됐다는 근거가 아니다.** 이를 새 개별 직원용 모바일 API가 있다는 근거로도 사용하지 않았다.

## 소스로 확인한 연결 공백

1. 앱은 `development-sample` 보관함과 가상 현장을 사용한다. 직원용 Firebase SDK 로그인·native 앱 설정·실제 현장 조회를 아직 주입하지 않았다.
2. `FieldApiClient`와 `SyncRunner`는 구현되어 있지만 UI에 연결하지 않았다. 사진의 `reservationRevision`을 서버 방문과 맞추는 단계가 없고, 값이 없으면 전송을 거부한다.
3. 제안한 `/v1/field-app` 경로는 배포 함수 export나 Hosting 경로에 없다. `functions/src/field-mobile/access.ts`는 독립 접근 검사 모듈이다.
4. 기존 field의 `operatorId`와 개별 직원 Auth UID 대응을 검증하지 않았다. 이름이나 클라이언트가 전달한 operatorId를 직원 권한으로 대체하지 않는다.
5. 새 모바일용 회사 Drive 보관 처리, 서버 PDF 생성, CRM 문서 연결 및 PC·모바일 공통 발송 제어를 아직 구현하지 않았다. 기존 데스크톱 OAuth broker의 준비 상태는 이 서버 보관 경로의 준비 상태와 별개다.

## 추가한 로컬 통합 시험

파일: `mobile-field/test/wire-integration.test.ts`.

실제 Node HTTP 서버를 `127.0.0.1`의 임의 포트에만 열고, 실제 fetch·`FieldApiClient`·`SyncRunner`·`SqlVault`·SQLite 파일·`authorizeMobile`·`authorizeMobileJob`·기존 CRM 보고서 변환을 결합했다. 시험 후 서버와 합성 데이터의 임시 DB를 정리한다. 배포 서버는 만들지 않았다.

| 시나리오 | 건수 | 확인 |
|---|---:|---|
| 예약·chunk·완료 응답 유실 후 SQLite 닫기/재열기 | 3 | 같은 예약 키, 서버 offset 복구, chunk 중복 없음, 완료 요청 중복 없음, 원본 hash 유지 |
| identity·App Check·CRM 활성 권한·현장 할당 거부 | 4 | HTTP 경계에서 차단, 추가 전송 없음, 재실행 시 자동 반복 없음, 원본 보존 |
| HTTP 성공이지만 Drive/CRM 확인이 불완전한 ready 응답 | 1 | 잘못된 완료 거부, 보고서 보관 가능 상태로 전환하지 않음 |

복구 시험에서 Drive 대기 → CRM 대기 → 양쪽 확인 상태를 순서대로 모의하며, 최종 상태에서만 보고서 보관 준비를 허용한다. 저장한 사진의 항목·분류·캡션과 건물 ID가 기존 CRM 보고서 구조로 연결되는지도 검사했다.

**시험 대역:** 원격 서비스 업무 처리, Firebase 토큰 검증기, App Check 검증기, 회사 권한 레코드, Drive/CRM 확인 상태. 전송용 바이트는 합성이며 실제 사진 디코딩을 시험하지 않는다. 논리 HTTPS 주소를 시험 안에서만 loopback HTTP로 매핑하므로 TLS 인증서나 native 네트워크 동작을 증명하지 않는다. Node SQLite는 SQLCipher 암호화의 증거가 아니다.

## 실행 결과

- `mobile-field`: `npm test` — **7개 파일, 57개 통과**. 이번 로컬 통합 시험 8개 포함.
- `mobile-field`: `npm run typecheck` — 통과.
- `desktop-crm`: `node --test test/work-report-core.test.js` — **24개 통과**.
- 합계 **81개 자동 테스트 통과**. 설계의 실제 기기·운영 수용 시험 완료 건수와 다르다.
- 테스트와 문서만 추가했다. 앱 실행 코드·서버·배포 설정은 변경하지 않았다. 앞선 export·Expo Doctor 결과는 [이전 검증 기록](verification-2026-10-26.md)에 있으며 이번에는 다시 빌드하지 않았다.

## 실제 연동 검증을 완료할 다음 순서

1. 회사 소유 Firebase에 Android/iOS 개발 앱과 native 인증·App Check를 구성한다.
2. 개별 직원 UID와 정식 현장 할당을 연결하고 방문·사진 API를 구현한다.
3. 회사 Drive 저장 경로와 서버 PDF·CRM 문서 저장 처리를 연결한다.
4. 실제 개발 기기에서 로그인·허용 현장·촬영·중단 복구·합성 테스트 보고서 보관을 검증한다.
5. 관리자 검토·공통 발송 제어를 연결한 뒤 지정 테스트 수신자에 대한 별도 승인 범위에서 전달을 확인한다.

이번 점검 중 앱 등록·운영 데이터 변경·Drive 업로드·PDF 저장·고객 메시지 요청·추가 배포는 수행하지 않았다.
