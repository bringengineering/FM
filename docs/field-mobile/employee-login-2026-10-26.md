# 직원 로그인·현장 조회 구현

> 이 문서는 2026-10-26 초기 구현 기록이다. **2026-10-27 사용자 확인에 따라 현장 선택은 CRM 고객정보의 건물주소를 직접 사용하는 방식으로 교체했다. 별도 건물 연결·업무 배정은 필요하지 않다.** 아래 `/jobs` 및 배정 조건은 이전 설치본 설명이다. 현재 `/sites` 조회·배포·실기기 상태는 [최신 연결 기록](expo-connection-2026-10-27.md)을 따른다.

2026-10-26 한국시간 22:02 기준. **코드와 개발 앱 등록 완료, 운영 API 배포·실기기 로그인 검증 전.**

## 구현한 동작

- 직원 개인 CRM 이메일/비밀번호 로그인, 이메일 확인·현재 회사 활성 권한 확인. 공개 회원가입이나 공용 계정 전환을 추가하지 않았다.
- React Native Firebase 27.1.0의 native Auth와 App Check를 사용한다. Android는 Play Integrity, Apple은 App Attest/DeviceCheck fallback이다. App Check를 Auth보다 먼저 초기화하고 같은 설치본에서 중복 초기화하지 않는다. SDK 토큰은 서버 요청 직전에 받아 헤더로 전달하며 앱 코드가 비밀번호나 토큰을 별도 저장하지 않는다. [SDK 설정 자료](https://rnfirebase.io/app-check/usage).
- 서버는 매번 토큰 프로젝트·취소 여부·현재 CRM 계정의 enabled/role/email/설정 대기/삭제 상태와 등록 native 앱을 확인한다. 아직 미등록인 서버 설정은 회사 데이터를 반환하지 않는다.
- 일반 직원은 `crmCompany/workOrders/{id}.assigneeUid`가 본인 UID인 업무만, 관리자는 유효한 진행 업무를 조회한다. 기존 공유 계정의 선택용 `operatorId`는 이 흐름에서 사용하지 않는다.
- 조회 대상은 `assigned`, `doing`, `returned` 상태이면서 정식 건물과 연결된 업무다. 폐기·삭제·잘못된 연결은 제외한다. 한 페이지는 원본 업무 최대 50개를 확인하고, 제외된 업무도 cursor를 진행시킨다.
- 현장 목록은 업무/건물 ID·업무명·건물명·주소·상태·시작일·기한만 반환한다. 건물주 연락처·출입 코드·내부 메모 등 전체 건물 레코드는 전달하지 않는다.
- 현장 상세를 열 때 권한과 배정을 다시 확인한다. 계정 변경/로그아웃 뒤 늦게 도착한 요청 결과는 폐기한다. 진행 중인 native 로그인이 완료된 뒤 로그아웃을 직렬 실행해 로그아웃 후 SDK에 이전 계정이 남는 경합을 막았다.
- 앱이 배경으로 가면 회사 화면을 가리고, 돌아오면 권한을 재확인한다. 입력 비밀번호는 제출/배경 이동 때 지운다. 회사 연결 화면과 가상 현장 기능 미리보기를 구분한다.

## 서버 읽기 API

함수 export는 `fieldMobileApi`, region은 `asia-northeast3`다. 배포가 완료된 URL이라는 뜻은 아니다.

| 경로 | 응답 |
|---|---|
| `GET /v1/field-app/context` | schemaVersion, 현재 actor, readJobs만 허용한 capabilities |
| `GET /v1/field-app/jobs?cursor=...` | 최소 현장 목록, 다음 cursor 또는 null |
| `GET /v1/field-app/jobs/{id}` | 접근 가능한 정식 현장 한 건 |

Firebase 함수 URL 뒤에 위 경로가 붙는다. POST/쓰기·추가 query·본문·경로 변조는 거부한다. 응답은 no-store다. 요청 횟수는 인스턴스별 UID당 분당 60회로 제한하고 인스턴스는 최대 2개다. 이는 전역 분산 rate limiter를 구현했다는 의미가 아니다.

조회 인덱스 `assigneeUid`를 기존 `cleaningOrderId` 옆에 추가한 **로컬 rules 변경**이 있다. 읽기·쓰기 권한 규칙 자체는 변경하지 않았다. 실제 index 배포 전에 최신 운영 rules와 비교해 인덱스 추가만 반영해야 한다. 이 작업에서는 함수나 rules를 배포하지 않았다.

## 회사 Firebase에 완료한 등록

- 프로젝트: `bring-fm`.
- 개발 package/bundle: `kr.co.bringengineering.fieldnotes.dev`.
- Android 앱 표시명: `BRING CARE Field Notes Dev Android`.
- iOS 앱 표시명: `BRING CARE Field Notes Dev iOS`.
- 두 플랫폼의 SDK 설정 파일을 `mobile-field/native-config/`에 내려받아 프로젝트·package/bundle·플랫폼·project number 일치를 검증했다. 해당 폴더는 Git에서 제외한다. 서버 allowlist에는 이 두 실제 앱 ID만 구성해야 한다.
- App Check 공급자 등록, Android 서명 지문 등록, Apple 팀·서명 설정, 스토어 등록, 고객 데이터 접근 권한 변경은 하지 않았다.

## 개발 실행

기본 `FIELD_CONNECTION=sample`은 가상 현장만 제공한다. 웹에서는 직원 자격증명을 입력받지 않는다. 회사 연결은 native Development Build에서만 사용한다.

```powershell
cd mobile-field
$env:FIELD_CONNECTION = 'company'
npx expo prebuild --platform android --no-install
npx expo start --dev-client --clear
```

위 명령이 기기에 앱을 설치하거나 서버를 배포하지는 않는다. 두 SDK 설정 파일이 없거나 다른 회사 앱이면 구성 검사가 실패한다. 설정 파일 위치는 `FIELD_COMPANY_CONFIG_DIR`로 지정할 수 있다. `FIELD_APP_ENV=production` 차단은 유지한다.

회사/미리보기 모드를 전환할 때 Metro 캐시가 이전 Expo manifest를 유지하는 것을 확인했다. 시작·export 시 `--clear`를 사용한다. `npm run export:check`에 해당 옵션을 반영했다. iOS 설정은 RN Firebase 27의 SPM 요구에 맞춰 dynamic frameworks로 구성했다. [공식 설치 자료](https://rnfirebase.io/).

## 검증 결과

| 검사 | 결과 |
|---|---|
| 모바일 TypeScript | 통과 |
| 모바일 자동 시험 | **11개 파일, 85개 통과** — 기존 57개 + 이번 28개 |
| Functions TypeScript build | 통과 |
| Functions 전체 시험 | **63개 파일 통과·2개 제외, 1,370개 통과·기존 14개 제외** |
| Expo Doctor | **20/20 통과** |
| 회사 설정 Android prebuild | 통과, SQLCipher·백업 차단·카메라 설정 유지 |
| 회사 설정 Android/iOS Hermes 및 웹 export | 통과 |
| 브라우저 확인 | 신규 진입 화면·웹 직원 로그인 비활성·기존 가상 현장 이동 확인 |

새 시험은 최소 데이터 투영, 다른 직원 차단, 재배정, 삭제 건물, pagination, 요청 변조, 권한 철회, native identity 불일치, App Check 선행 초기화, 응답 지연·로그아웃 경합을 검증한다. native SDK 자체와 서버 Auth 검증은 시험 대역으로 구성한 계약 시험이다.

전체 병렬 빌드 중 기존 실제 socket/SQLite 복구 시험 2개가 기본 5초 제한을 넘었다. 해당 3개 네트워크 복구 시나리오만 15초로 조정했으며 최종 모바일 전체 85개가 통과했다. 상태·중복·무결성 assertion을 제거하거나 완화하지 않았다.

Node 24에서 검증했다. Functions 선언 runtime은 Node 22이므로 운영 runtime 실행 검증은 별도로 남는다. Android SDK/JDK 및 iOS Xcode 실행 환경·서명 연결이 없어 APK/IPA 생성·설치·실기기 인증은 미검증이다.

의존성 audit: high 8건·critical 0건. 기존 Expo CLI `node-forge`/`zod` 경고와 Expo peer 경로의 패키지 집계가 남는다. 이번에 유입된 구버전 gRPC는 같은 major의 1.14.6 고정으로 정정했다. 배포 전 개발 도구 경고 해소 검증이 필요하다.

## 실제 로그인까지 남은 준비

1. 테스트 휴대폰과 회사 개발 빌드 서명을 정한다. Android는 앱 서명 SHA-256과 Play Integrity 연결, Apple은 개발자 팀과 App Attest/DeviceCheck 구성이 필요하다. [Android 설정](https://firebase.google.com/docs/app-check/android/play-integrity-provider), [Apple 설정](https://firebase.google.com/docs/app-check/ios/app-attest-provider).
2. 회사 설정의 두 native 앱 ID를 서버 allowlist에 구성하고, 최신 운영 기준에서 새 읽기 함수와 필요한 인덱스만 적용한다. 기존 web/CRM 인증 정책을 전체 App Check enforcement로 변경하지 않는다.
3. 설치된 실제 앱에서 직원이 직접 로그인해 본인 현장·관리자 목록·재배정·로그아웃·인증 철회를 확인한다. agent가 직원 비밀번호를 받거나 대신 입력하는 절차는 없다.
4. 그 뒤 방문 생성·사진 전송·Drive 활동사진·PDF/CRM 보관을 연결한다. 현재 회사 현장 상세는 읽기 전용이며 촬영·고객 발송 가능 상태로 표시하지 않는다.

최신 기준에서 M1 완료 판정은 아직 보류다. Firebase 앱 등록은 실제 완료했지만, 등록만으로 기기 인증이나 실제 현장 조회 성공을 주장하지 않는다.
