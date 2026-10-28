# 회사 Expo 프로젝트 연결

> 현재 기준: Android 0.1.1 실제 로그인은 확인됐다. 사용자의 CRM은 고객정보에 건물주소를 입력하므로, 초기 건물/업무 연결 조건을 제거한 `/sites` API를 배포했고 Android 0.1.2 (3) APK를 완성했다. 아래 기록은 시간순이며 마지막 고객주소 수정 항목을 우선한다.

2026-10-27. 사용자가 직접 만든 프로젝트를 확인해 연결했고 **Android 내부 설치본 APK 생성에 성공했다**. 직원의 실제 로그인·현장 조회와 사진/보고서 전송 완료를 의미하지 않는다.

## 연결 완료

- 프로젝트: [bringengineerings-team / bring-care-field-notes](https://expo.dev/accounts/bringengineerings-team/projects/bring-care-field-notes).
- 표시명: `BRING CARE 현장노트 개발`.
- 공개 프로젝트 ID: `574e39cc-26d0-4b2f-9dbb-22d273515ce3`.
- 사용자의 브라우저 로그인 세션으로 EAS CLI 공식 OAuth 연결을 완료했다. 비밀번호·OTP·토큰을 소스나 문서에 저장하지 않는다. 공식 CLI가 자체 인증 상태를 관리한다.
- `eas project:info`로 실제 서버의 프로젝트 이름과 ID 일치를 확인했다.
- `mobile-field/config/eas-project.json`에 공개 소유자·프로젝트 ID를 고정했다. 다른 환경변수 값으로 빌드 대상을 변경하려 하면 구성 검사가 실패한다. 이 파일에는 인증정보가 없다.
- EAS 프로젝트 `preview` 환경에 `FIELD_ANDROID_CONFIG_FILE`, `FIELD_IOS_CONFIG_FILE`을 **Secret / file**로 등록했다. 등록 목록에서 이름·유형·범위를 확인했으며 값을 출력하지 않았다. 설정 파일은 Git과 앱 소스 업로드에서 제외한다.

## 업로드와 빌드

회사 계정의 현재 플랜은 Free다. 첫 요청 전 사용량은 Android 0건·iOS 0건이며 플랜에 각 15건이 포함됨을 화면에서 확인했다. 플랜 변경·결제·스토어 제출은 하지 않았다.

저장소 루트의 `.easignore`에 업로드 허용 범위를 명시했다. 앱 코드·빌드 설정·의존성 lockfile·공통 `desktop-crm/src/work-report-core.js`만 포함한다. 전체 CRM 소스, 고객 자료, 인증 파일, Git 이력, 로컬 native 산출물은 포함하지 않는다.

`eas build:inspect --stage archive`의 실제 복사 결과는 **31개 파일, 440,356바이트**, 허용 범위 밖 파일 0개였다. 공유 보고서 core와 앱 진입 파일의 존재도 확인했다. Windows에서 디렉터리 예외를 평가하는 방식에 맞춰 `.easignore`의 디렉터리 예외에 끝 슬래시를 쓰지 않았다. 첫 빈 검사용 디렉터리는 서버에 올리지 않았다. [공식 archive 안내](https://docs.expo.dev/build-reference/easignore/).

Android 서명 키는 EAS가 개발 앱 ID `kr.co.bringengineering.fieldnotes.dev`용으로 생성·관리한다. 서명 키나 비밀번호를 내려받거나 문서에 기록하지 않았다.

EAS CLI의 공개 SHA-256 인증서 지문을 확인하고, 기존 등록 지문이 없는 Firebase Android 개발 앱 `1:864976295990:android:644a2b7d5242a0b5eb6097`에 추가했다. Firebase가 `SHA_256` 등록 성공을 반환했다. 이는 서명 지문 등록이며 Play Integrity 공급자·검증 설정을 완료했다는 뜻은 아니다. 기존 회사 웹 앱이나 다른 Android 앱은 변경하지 않았다.

| 항목 | 값 |
|---|---|
| 첫 빌드 | [42c26703](https://expo.dev/accounts/bringengineerings-team/projects/bring-care-field-notes/builds/42c26703-0d40-4f22-aa16-969350f27641) |
| 플랫폼 / 프로필 | Android / `company-preview` |
| 배포 / 버전 | Internal APK / 0.1.0 (1) |
| 요청 소스 | `4f3c01e8` |
| 상태 | 실패. Firebase Auth 25.0.0의 Kotlin 2.4 메타데이터와 기본 Kotlin 2.2 컴파일러가 호환되지 않음 |

첫 실제 빌드에서 `:react-native-firebase_auth:compileReleaseKotlin` 실패를 확인했다. 최종 수정은 `expo-build-properties`의 공식 `android.kotlinVersion`을 **2.4.20**으로 고정하는 것이다. Firebase Auth의 메타데이터를 읽고 사용 중인 Gradle 9.4.1·AGP 9.2.1을 지원하며, Expo의 Pika/modules compiler도 이 버전으로 배포돼 있다. Kotlin 메타데이터 검사를 끄거나 Firebase 인증을 제거하지 않았다. 최종 수정 소스는 `e8e2e48d`다. [Expo 설정](https://docs.expo.dev/versions/latest/sdk/build-properties/), [Kotlin/Gradle/AGP 호환표](https://kotlinlang.org/docs/gradle-configure-project.html).

중간 재빌드 [feec6282](https://expo.dev/accounts/bringengineerings-team/projects/bring-care-field-notes/builds/feec6282-97a1-4a78-ab4a-1fa52a2b312b)는 Kotlin 2.4.21용 Expo compiler artifact가 없어 실패했다. Maven Central의 실제 버전 목록에서 Pika `1.1.0-2.4.20`과 modules compiler `0.2.5-2.4.20`의 제공을 확인해 수정했다. 저장소 fallback의 HTTP 401을 사용자 인증 문제로 취급하거나 별도 인증을 시도하지 않았다.

최종 수정 빌드: [cc59a01d](https://expo.dev/accounts/bringengineerings-team/projects/bring-care-field-notes/builds/cc59a01d-59a1-405f-9e1a-fc6b53d45cc9). 기존 개발 서명을 재사용하며 `--freeze-credentials`로 서명 변경을 막았다. **한국시간 2026-10-27 09:53:48에 FINISHED / Succeeded로 완료**됐다. 총 소요 10분 23초였다. 요청 시 변경 중이던 문서는 업로드 대상에서 제외됐으며 앱 소스는 `e8e2e48d` 기준이다.

설치 파일을 로컬로 내려받아 다음을 확인했다.

- 파일: `C:/Users/dpvld/.codex/visualizations/2026/10/15/01a13ddf-321b-7df3-bfc1-72ce90737b84/bring-care-field-notes-dev-0.1.0-20261027.apk`.
- 크기: **118,600,521바이트**.
- SHA-256: `B5770B7D4C247FFFAFD6240374906F55C9AC8F7FB79064417F8A67E7B73D195F`.
- APK ZIP을 열어 1,321개 항목, AndroidManifest.xml·classes.dex, arm64-v8a·armeabi-v7a·x86·x86_64 네이티브 라이브러리 포함을 확인했다.
- Expo의 설치 QR 화면을 열어두었으며 별도 이미지를 저장했다. APK 구조와 다운로드 해시는 확인했지만 기기에 설치·실행하거나 로컬 apksigner로 서명을 검증한 것은 아니다.

빌드 로그에는 Google Play Services Auth 21.5.0의 R8 stack-map 경고가 남지만 빌드는 성공했다. 관련 기기 로그인 동작은 실기기로 확인해야 한다. 경고를 숨기거나 R8 검사를 비활성화하지 않았다.

## 설정 검증

- TypeScript 통과.
- 회사 설정 테스트 **4개 통과**. 연결 프로젝트 사용, 잘못된 소유자/프로젝트 덮어쓰기 거부 포함.
- `npm run device:check`: Firebase 파일 일치·Expo 소유자·프로젝트 연결 모두 true, 로컬 설정 오류 없음.
- 회사 모드의 Expo config에서 실제 소유자·프로젝트·slug와 양쪽 개발 package/bundle 확인.
- 클라우드에서 의존성 설치·Expo Doctor·prebuild를 거쳐 JavaScript 번들 생성 단계까지 진입했다.
- 수정 후 TypeScript 재검사 및 Expo introspection에서 Kotlin 2.4.20 적용을 확인했다. SQLCipher·Android 백업 차단·회사 프로젝트 설정은 유지한다.

## 다음 단계

1. Android 휴대폰에 개발 APK를 설치하고 실제 실행을 확인한다. 카메라·암호화 보관함·기기 재시작 검증도 별도로 진행한다. 현재 회사 모드의 현장 화면은 읽기 전용이다.
2. Google Play Console 및 Android Play Integrity 공급자 설정을 준비한다. 개발 서명의 Firebase SHA-256 등록은 완료했으며 App Check 검증 조건을 우회하지 않는다.
3. 최신 운영 기준으로 읽기 API와 필요한 조회 인덱스·native 앱 허용 목록을 적용하고 직원이 본인 계정으로 로그인·현장 조회를 시험한다. 현재 읽기 API는 아직 배포하지 않았다.
4. iPhone EAS 내부 설치본·TestFlight·App Store 배포에는 활성 Apple Developer 멤버십과 기기/서명이 필요하다. 사용자는 비용 필요 여부를 문의했으며 가입 완료는 아직 확인하지 못했다. Mac의 Xcode Personal Team 무료 시험은 7일 재설치 제한이 있다. [Apple 개발자 계정 안내](https://developer.apple.com/help/account/basics/about-your-developer-account).
5. 회사 현장의 방문 생성·사진 업로드·Drive 보관·PDF 생성·CRM 발송 구현을 이어간다. 현재 회사 화면은 읽기 전용이다.

이 문서는 2026-10-26 준비 문서의 ‘Expo 미연결’ 상태를 대체한다. 계정 결제·운영 API 배포·고객 발송은 이번 프로젝트 연결 작업에서 수행하지 않았다.

## 후속 Android 서버 연결 — 2026-10-27 10:22 KST

사용자는 APK 설치를 완료했고 회사 계정 또는 앱 인증 오류를 보고했다. 확인 당시 모바일 읽기 함수는 없었으며 Play Integrity API는 비활성화, 앱 검증은 Play 설치본용 기본 조건이었다. 아래 후속 작업은 앞의 빌드 시점 상태를 대체한다.

- `playintegrity.googleapis.com` 활성화 후 `ENABLED`를 확인했다.
- 개발 Android 앱에 직접 설치용 공식 권장 조건을 설정했다. `allowUnrecognizedVersion=true`, `requireLicensed=false`, `MEETS_DEVICE_INTEGRITY` 필수, TTL 3,600초. 등록한 APK SHA-256 지문 일치도 재확인했다. 전역 App Check 강제 적용이나 기존 앱 설정은 바꾸지 않았다. [Firebase의 배포 경로별 권장 설정](https://firebase.google.com/docs/app-check/android/play-integrity-provider).
- `release/field-mobile-bundle.cjs`로 감사 대상 모듈 5개와 초기화 진입점만 묶고 `field-mobile` 코드베이스의 `fieldMobileApi` 하나를 `bring-fm / asia-northeast3 / Node.js 22`에 배포했다. 서버 허용 앱은 Android 개발 앱 하나다. 기존 `field-platform` 진입점에는 중복 export를 남기지 않았다.
- `FIELD_MOBILE_NATIVE_APP_IDS` 실제 배포 값, 함수 `ACTIVE`, 코드 해시 `9faa008f8363e7022297ff7c575e6452c90ad3b7`를 확인했다. 기존 42개 함수의 이름·region·상태·코드 해시·소스 위치는 배포 전후 일치했다.
- 운영 RTDB 규칙을 별도 백업하고 최신 내용이 그대로인지 다시 비교한 뒤 `crmCompany/workOrders/.indexOn`에 `assigneeUid`만 추가했다. 재조회에서 이 항목 외 전체 규칙이 동일함을 확인했다. 오래된 로컬 규칙 전체를 배포하지 않았다.
- 검증: 모바일 87개, 배포 범위 3개 테스트 통과, Functions TypeScript 빌드 통과. Node 22.23.4에서 실제 배포 진입점의 export가 `fieldMobileApi` 하나임을 확인했다.
- 실제 운영 URL 검증: 인증 없음과 임의 테스트 토큰 모두 401 `MOBILE_AUTH_REQUIRED`, POST 405 `METHOD_NOT_ALLOWED`, 임의 직원 쿼리 400 `REQUEST_INVALID`, 모든 응답 `Cache-Control: no-store`. 인증을 대신 만들어 정상 로그인 시험을 하지 않았다.

운영 검증 기록과 규칙 백업은 Git 제외 경로 `.firebase/field-mobile-verification/`에 있다. 사용자에게 앱 완전 종료·재실행 후 본인의 CRM 계정으로 로그인을 요청했다. **실기기 정상 로그인·목록/상세 조회 결과는 아직 확인 중이다.** 비밀번호·토큰·개인정보를 기록하지 않는다. 회사 사진 업로드·보고서 보관·고객 발송은 이번 조회 API 배포 범위에 포함되지 않는다.

## 로그인 오류 진단 업데이트 — 2026-10-27 10:40 KST

사용자의 재시도에서 계정·비밀번호 공통 오류가 표시됐다. 사용자는 같은 계정의 PC 로그인은 정상이라고 확인했다. Android 설정 파일의 프로젝트·package 일치, API 키의 Authentication/App Check 허용, 이메일 로그인 활성, MFA 비활성 상태를 읽기 전용 확인했다. 임의의 잘못된 토큰을 사용하는 비로그인 요청도 키 제한 오류가 아닌 `INVALID_ID_TOKEN`으로 거절됐다. 사용자 인증정보를 받아 대신 로그인하거나 계정 상태를 변경하지 않았다.

기존 설치본의 모든 native 로그인 실패를 한 문구로 숨기던 처리를 수정했다. 잘못된 자격 증명, 이메일 인증 미완료, 계정 중지, Android 앱 등록 문제, 네트워크, 요청 제한, 앱 attestation 실패를 고정된 코드·안내로 구분한다. 알 수 없는 공급자 응답의 원문·URL·계정 정보는 표시하지 않는다. 로그인 뒤 서버 처리 실패를 비밀번호 오류로 표시하지 않으며, attestation 실패 때 전송 큐도 중지한다.

- 소스: `3df19691`.
- TypeScript 통과. 관련 테스트 95개 통과(전체 실행 94개 통과 후 바뀐 안내 기대값을 수정하고 해당 7개 재실행 통과).
- [Android 0.1.1 (2) 설치 페이지](https://expo.dev/accounts/bringengineerings-team/projects/bring-care-field-notes/builds/aa23038d-b363-459f-8153-e013457491d1).
- EAS `FINISHED`: 2026-10-27 10:40:45 KST, 총 9분 30초. 같은 개발 package·서명으로 업데이트할 수 있다.
- 다운로드: 118,602,629바이트, SHA-256 `6BBF09106E55A4B5B433B2EF2CE4A991E8F982E46E157F04318B17B1A19D820C`.
- APK v2 서명 블록에서 인증서를 추출해 기존 APK·Firebase 등록 SHA-256 지문과 일치함을 확인했다. 이는 인증서 비교이며 apksigner 전체 서명 검증은 아니다.
- Chrome에 새 설치 QR을 열고 사용자에게 기존 앱 위에 업데이트 후 로그인 결과/고정 오류 문구를 요청했다. **업데이트 후 실제 로그인 결과는 아직 대기 중이며 오류 해결 완료로 판정하지 않았다.**

## 실기기 로그인·조회 확인 — 2026-10-27 10:43 KST

사용자가 0.1.1 업데이트 후 로그인 성공과 빈 현장 목록을 확인했다. 운영 요청 로그에서도 10:43:01/10:43:11의 `context`, 10:43:04/10:43:12의 `jobs`가 모두 HTTP 200이었다. 이는 실제 설치본의 Firebase 로그인, Play Integrity App Check, native 앱 allowlist, 현재 CRM 계정 권한, 목록 API 호출이 통과했음을 확인한 결과다. 사용자 계정·토큰·주소·로그 원문은 기록하지 않았다.

빈 목록 원인을 별도 읽기 전용 집계로 확인했다. 현재 CRM 업무지시 32건(배정 20건, 완료 12건)은 담당자가 있으나 `buildingId` 연결은 모두 비어 있다. 건물 목록은 11건이며, 기존 가상 테스트 건물 2건도 정상 상태다. 현재 모바일 조회 규약은 건물에 연결된 진행 업무만 반환하므로 빈 목록은 이 데이터 상태에 부합한다. 기존 업무·담당자·실제 건물 자료를 수정하거나 가짜 배정을 생성하지 않았다.

당시 실기기 로그인 및 빈 목록 조회는 확인됐으나, 건물/업무 연결이 필요하다는 해석은 잘못됐다. 사용자 확인에 따라 아래 고객주소 방식으로 수정했다. 고객에게 건물 연결이나 업무 배정을 추가로 요구하지 않는다.

## CRM 고객주소 조회로 수정 — 2026-10-27 11:00 KST

사용자는 건물 연결을 없애고 고객정보에 건물주소를 직접 입력하는 기존 운영 방식을 재확인했다. 고객 데이터의 `roadAddress` → `address` → `jibunAddress` 순서로 주소를 사용하며, 고객 ID로 목록과 상세를 식별한다. 고객 별칭 또는 이름과 주소만 표시한다. 주소 없는 고객도 목록에 남겨 `주소 미입력`으로 안내한다. 같은 주소/이름을 가진 고객을 합치거나 기존 buildingId로 추론하지 않는다.

- 소스: `ad8aefa4c21ba93bb3dc22a328876c3d90a9e958`.
- 새 API: `GET /v1/field-app/sites`, `GET /v1/field-app/sites/{customerId}`. 현재 활성 CRM 사무직 권한·native App Check를 매 요청 확인한다. 기존 권한 규칙이나 고객 데이터를 수정하지 않았다.
- 이전 `/jobs` API는 이전 설치본 호환을 위해 남기고, 0.1.2 회사 화면은 `/sites`만 사용한다. 응답에 연락처·이메일·메모·동의·문서 링크를 포함하지 않는다.
- TypeScript 모바일/Functions 빌드 통과. 모바일 전체 109개 통과 후 응답 최소화/다른 고객 상세 거부 테스트 1개 추가 및 고객주소 관련 15개 재실행 통과(총 110개). 배포 범위 테스트 3개 통과.
- 읽기 전용 운영 데이터와 배포에 사용한 코드로 고객 조회 결과를 검증했다. 활성 고객 21명, 주소 등록 12명, 미입력 9명이며 기존 테스트 고객의 목록/상세도 일치했다. 이는 서버 데이터/코드 검증이며 휴대폰에서 새 버전으로 로그인한 결과를 대신하지 않는다.
- `field-mobile:fieldMobileApi`만 배포했다. 11:00:13 KST 검증에서 상태 `ACTIVE`, 코드 hash `767f20193a4dac88432e16369c95ebe4b2f18b56`. 다른 운영 함수 42개의 소스·상태가 배포 전과 동일하다.
- 운영 `/sites` 목록·상세는 인증 없음/임의 토큰을 401로 거부했다. POST 405, 임의 직원 쿼리 400, no-store를 확인했다.
- [Android 0.1.2 (3) 설치 페이지](https://expo.dev/accounts/bringengineerings-team/projects/bring-care-field-notes/builds/e01e7050-2567-4e99-b07e-1603c1a3d509). 10:57:43 KST 접수, **11:08:15 KST `FINISHED`**. 같은 개발 package·서명으로 기존 앱 위에 업데이트한다.
- APK 다운로드 118,601,905바이트, SHA-256 `80701F36CA11660167F8CDDE4572E4E02141496695469EEE3ED56AC465654E84`. APK v2 서명 블록의 인증서 지문이 기존 APK·Firebase 등록과 일치한다. 인증서 비교이며 apksigner 전체 서명 검증은 아니다.
- Chrome에 새 버전의 Install QR을 열고 사용자에게 업데이트 후 고객 목록·주소·상세 확인을 요청했다. 실제 휴대폰 결과는 아직 대기 중이다.

남은 확인은 사용자 휴대폰의 고객 목록/건물주소/상세 조회다. 사진·Drive·PDF 보관·고객 발송은 아직 별도 연결 단계다.


## 촬영·활동사진·보고서 연결 — 2026-10-27

사용자가 Android 0.1.2의 고객 목록·주소가 정상임을 확인했다. 별도 건물 연결 없이 고객 ID로 사진 방문과 보고서를 연결했다.

- Android 0.1.3 (4): EAS 74b7b528-1edf-4bfe-8475-ff5d5b13295a, 2026-10-27 18:29:30 KST FINISHED. 기존 서명 인증서와 일치(인증서 비교이며 apksigner 전체 서명 검증은 아님). APK 118,626,689 bytes, SHA-256 d15ef30f6efb2c804cbef9164a1a1158f61e967ef986ab864bd6379b3b72359d.
- EAS 제출 파일 35개는 앱 소스·공유 보고서 core만 포함. Firebase 플랫폼 파일은 기존 EAS 파일 환경변수 사용. 인증정보·실제 고객 자료를 포함하지 않음.
- 단독 field-mobile 코드베이스의 fieldMobileApi만 업데이트. 배포 직후 기존 42개 함수 설정·hash 불변을 확인. 최종 hash 44433b627b3d072f2fae0756bb8726882a114785. Node 22 로딩과 단일 export 검증 통과.
- 현재 직원 권한·App Check를 쓰기마다 검증. 방문/revision 일치 → 청크 업로드 → JPEG/해시 검사 → 기존 활동사진 루트 비공개 저장 → 선택 사진과 검토한 본문의 한글 PDF → 기존 건물 문서함 루트와 CRM 보관 순서. 서버 ID 고정과 비교로 재시도 시 중복·다른 직원/고객 자료 대체를 차단.
- 모바일 TypeScript 및 114개 시험 통과. 실제 클라이언트·SQLite·HTTP 서비스 연결 시험은 합성 신원/Drive/PDF 대체 사용. Functions 전체 1380개 통과(기존 에뮬레이터 제외 14개), 이후 Drive 어댑터 2개 추가 시험과 PDF/서비스 12개 재검증 통과. 실제 합성 PDF를 렌더링해 한글·사진·캡션·1551-3873 표기 확인. 익명 /context, /recording/context, /recording/storage, /visits 요청은 모두 401.
- PC CRM 호환 PR #240 병합 d82bcd95a951e056370fdee0eb49a429d7c6285b. 고객 ID를 보존하고 고객 기준 저장본 조회·수정·발송 검증 지원. 활성 고객만 허용하고 기존 고객 ID 삭제·대체를 차단하는 규칙 에뮬레이터 시험 추가. 전체 CI와 규칙 배포 통과.
- CRM v1.91.0 정식 릴리스 40479529388의 예약·전체 시험·설치 파일 검증·관련 백엔드/Worker·정식 공개·채널 검증 통과. 공개 업데이트 채널도 1.91.0 확인.
- 실제 고객 메시지·실제 사진·새 운영 테스트 보고서를 만들거나 보내지 않음. 휴대폰 새 버전 설치 후 실제 카메라·회사 Drive 연결·PDF 보관 결과 확인이 남아 있음.

PC 실행본은 1.89.1.0이었다. Windows 제어의 업데이트 버튼 클릭이 geometry unavailable 오류로 두 번 실패해 UI 입력을 중단했다. 사용자에게 상단 최신 확인으로 v1.91.0 업데이트를 안내했다. Android 0.1.3 설치 상태 질문은 대기 중이며, 실제 휴대폰·Drive 성공으로 보고하지 않았다. 구현 소스 커밋은 08cf035d다.


## Android 보관함 초기화·구역별 저장 수정 — 2026-10-27

사용자가 0.1.3 설치 후 고객 선택 → 사진 촬영·보고서 작성 진입 시 저장 실패를 확인했다. 운영 로그의 해당 로그인·고객 조회·recording/context는 200이고 사진 업로드나 보고서 요청은 없었으므로 실패는 서버 요청 이전이다. Expo SQLite의 Android 기본 DB 경로는 /data/... 절대 경로지만 Expo FileSystem Android 구현은 file:/// URI를 요구한다. 첫 보관함 생성 때 파일 존재 확인에 원시 경로를 넘기던 부분을 URI로 변환하고, 보관함 확인·보안 키·DB 열기·초기화 오류를 안전한 고정 코드로 구분했다. 기존 키가 없고 DB가 있으면 새 키를 만들지 않는 보호는 유지한다.

구역과 작업 전·중·후를 선택해 촬영한 사진을 보고서 항목별로 묶어 표시하고, 현재 초안·사진을 검토해 ‘사진·보고서 저장’을 누르면 로컬 초안 저장 → 서버 revision 확인 → Drive 사진 보관 → PDF 생성·CRM 보관까지 진행한다. 업로드 실패 후에도 기존 사진·초안을 유지하고 확인된 revision으로 재시도한다. 고객 주소를 나중에 등록한 기존 작업은 고객 ID를 바꾸지 않고 빈 주소만 채울 수 있다. 자동으로 작업 완료 상태를 지정하거나 고객 메시지를 보내지 않는다.

Android 0.1.4 (5) EAS build 5d2cfb2e-2cf6-46d0-98e5-2da19e9b3311을 생성 중이다. TypeScript 및 전체 118개 테스트 통과. 첫 실행 경로 URI, 기존 키 유실 보호, 구역별 사진 묶음, 저장 실패 후 같은 revision 재시도, 실제 클라이언트·SQLite·HTTP 서비스 연결(Drive·인증·PDF는 합성 대체) 테스트를 별도로 확인했다. 실제 휴대폰의 보관함 진입·촬영·Drive/PDF 성공은 아직 확인하지 않았다.

Android 0.1.4 (5)는 2026-10-27 20:40:16 KST 빌드 완료. APK 118,633,173 bytes, SHA-256 272e5bd1fa5f3b220d4cc0dfa0fc93d31e270e03c4f3a23457c5b70240a2660b. 기존 앱과 APK v2 서명 인증서 일치(인증서 비교; 전체 apksigner 검증은 아님). 설치 자료는 앱 소스·공유 report core 36개 파일만 포함. 사용자에게 기존 앱 위 업데이트와 TEST 고객에서 실제 촬영·Drive·PDF 보관 시험을 요청했으며 결과는 아직 대기 중이다.


## 구역별 작업 전·후 안내 촬영 — 2026-10-27

사용자가 0.1.4 저장이 된다고 확인했고, 쏘카 외관 촬영처럼 작업 전 구역들을 순서대로 촬영한 뒤 작업 후 같은 구역들을 다시 촬영하고 싶다고 요청했다. 0.1.4의 기록 화면 접속은 HTTP 200이었으나 그 시점까지 Drive 저장·PDF 요청은 로그에서 관측되지 않아 실제 보관 성공으로 판단하지 않았다.

현장에 해당하는 촬영 구역을 고르면 선택 목록을 UID별 암호화 보관함에 저장하고, 작업 전·후 각각 구역별 진행 수와 사진 장수를 표시한다. 촬영 후 다음 미촬영 구역을 안내하며 이전 구역을 다시 눌러 여러 장을 찍을 수 있다. 작업 후 카메라에는 같은 구역의 작업 전 사진을 참고 표시한다. 누락 구역은 완료로 간주하지 않고 확인할 수 있게 남긴다. 이전 앱에서 촬영한 사진은 유지하며 기존 작업에 구역 선택을 추가할 수 있다.

활동사진의 새 사진 경로는 고객/작업일/작업 전·중·후/구역이며 이전에 저장된 사진은 이동하지 않는다. 보고서는 선택 사진 최대 100장·원본 합계 64 MiB를 받아 PDF 12 MiB 이내로 축소해 보관하고 Drive 원본은 유지한다. 작업 전·후 구역 매칭, 앱 재실행 후 선택·사진 보존, 100장 수집 및 실제 합성 PDF 생성, 재시도와 개인계정 분리를 자동 시험했다. 웹 미리보기는 합성 사진만 이용해 카메라·다음 구역 전환·작업 후 참조 및 휴대폰 크기 배치를 확인했다.

서버는 fieldMobileApi만 배포했으며 함수 43개 중 다른 42개의 hash 불변, 익명 요청 401을 확인했다. 최종 서버 hash b8bdeadb227a8910aebb271ade6e8ac63b2e9a71. Android 0.1.5 (6) build 09ccd6ba-e0b2-4d5d-8df6-2514fc800dd9 생성 중이다. 실제 휴대폰에서 새 구역 촬영과 Drive·PDF 보관 결과는 별도로 확인해야 한다.

보고서 PDF는 구역마다 촬영 시각순으로 작업 전을 왼쪽, 작업 후를 오른쪽에 배치하며 짝이 없는 칸은 ‘사진 없음’으로 표시한다. 다음 페이지로 이어지면 구역명을 다시 표시한다. 작업 중 사진은 별도로 배치한다. 합성 PDF 렌더링으로 한글·전후 배치·대표번호를 확인하고 100장 PDF 및 순서·빈칸 시험을 통과했다. fieldMobileApi 단독 재배포 후 hash b785febf0b63ffe9eac766fceeb656a0e1fa3e8f, 다른 42개 함수 hash 불변과 익명 401을 확인했다.

Android 0.1.5 (6) build 09ccd6ba-e0b2-4d5d-8df6-2514fc800dd9는 2026-10-27 21:07:24 KST 완료됐다. APK 118,642,537 bytes, SHA-256 d8d50a3c47230685c7d0e15eb9f60591927588e644ff65cf763e4bdb96fd243b; 기존 앱과 APK v2 서명 인증서가 일치한다(인증서 비교이며 전체 서명 검증은 아님). 설치 archive는 앱 소스·공유 core 37개 파일만 포함한다. 모바일 전체 121개, 서버 전체 1384개 시험 통과(14개 기존 제외), 이후 보고서 사진 짝 배치 및 100장 PDF 시험을 포함한 서버 15개 재검증 통과. 테스트 고객으로 휴대폰에서 전·후 촬영과 Drive·PDF 저장 결과 확인을 요청했으며 아직 대기 중이다.

## Drive 접근 진단과 AI 초안 — 2026-10-27

0.1.5 실기기 저장 시 회사 Drive 폴더 접근 오류를 확인했다. 서버 `/recording/storage` 단계에서 503이 발생했으며 어떤 루트 또는 권한 조건인지 아직 확인되지 않았다. fieldMobileApi에 실패한 루트 종류, HTTP 상태 또는 폴더 속성의 참·거짓만 출력하는 진단을 추가해 단독 배포했다. 토큰·계정·폴더 ID·고객정보나 Google 원문은 기록하지 않는다. 같은 테스트 작업에서 저장을 재시도한 뒤 원인을 확인해야 한다. 사진 원본과 초안은 기기에 유지한다.

0.1.6은 촬영 완료 후 직원이 확인·수정할 AI 초안을 만들며, 사진·고객명·주소·사진 설명은 AI에 보내지 않는다. 서버는 고정 구역 키와 사진 수만 허용하고 활성 직원 계정과 Android App Check를 확인한다. AI Worker 변경은 PR #246, 0.1.6 설치본은 EAS 04e05568-1415-4dde-8eb9-8da643d1b863에서 검증 중이다. 앱 설치·실기기 AI/Drive/PDF는 아직 미확인이다.

PR #246은 모든 CI 통과 후 5c1c591b95bb72a3cb08299625691555ca12c8a8로 병합하고 AI Worker version 6e0de0f3-dc62-4eb0-bc16-6de8576c9dbd를 배포했다. 운영 health 200, 익명 AI 초안 요청 401을 확인했다. Worker 전체 297개, 모바일 전체 124개 테스트 통과. 활성 직원의 실기기 요청·Gemini 결과와 Drive/PDF 보관은 아직 확인하지 않았다.

Android 0.1.6 (7)은 2026-10-27 21:37:26 KST에 빌드 완료됐다. APK 118,648,009 bytes, SHA-256 34b0e804623bafb5aba2e058f8d57092e55ef2ec2ae57b87e7eb4888042a9882. 기존 앱과 APK v2 인증서가 일치한다(인증서 비교이며 전체 apksigner 검증은 아님). 사용자에게 기존 앱 위에 설치하고 TEST 작업으로 AI 초안 및 Drive/PDF 보관 재확인을 요청했다.

사용자가 0.1.6에서도 Drive 폴더 오류를 확인했다. 해당 서버 재시도는 사진 루트 Google Drive HTTP 404로 실패했다. 별도 Drive 연결에서는 활동사진과 보고서 폴더의 목록 조회가 가능했으나, 서버 OAuth 자격과 동일하다는 뜻은 아니며 404만으로 실제 폴더 삭제 여부나 권한 범위를 확정할 수 없다. 다음 재시도에서 두 루트를 각각 확인하고 서버의 토큰 권한 범주(full/file/other/unknown)만 기록하도록 fieldMobileApi를 재배포했다. 사용자 요청으로 휴대폰 재시도는 나중으로 미뤘다.

## 검수 후 수정 — 2026-10-27

사용자가 수정·확인을 요청했다. 0.1.7은 기존 AI 초안의 촬영 구역·사진 수를 기기 보관함에 함께 기억해 추가 촬영 후 촬영 완료를 누르면 수정되지 않은 AI 초안을 갱신한다. 사람이 수정한 문장은 자동으로 덮어쓰지 않고 사진이 바뀌었음을 안내한다. 서버의 새 보관 요청은 선택한 구역만 PDF와 저장 보고서에 넣고, 직원이 별도로 작성한 항목은 보존한다. 기존 클라이언트 요청은 이전 형식 그대로 처리하며 선택 구역이 포함된 요청은 별도의 결정적 문서 ID로 중복 재시도를 막는다. 기존 PC CRM 버전은 보고서를 편집할 때 표준 필수 항목을 다시 채우므로 PC를 수정한 버전으로 업데이트해야 한다.

촬영 실패 시 변환된 임시 복사본은 정리하고 유일한 원본은 유실 방지를 위해 보존한다. 이 경우 원본이 암호화 보관함 바깥의 앱 캐시에 남을 수 있어 완전한 임시파일 보호는 아직 해결되지 않았다. Drive 404의 권한 범주 확인은 사용자가 휴대폰 재시도를 나중으로 미뤘으므로 미확인이다. fieldMobileApi 단독 배포와 익명 요청 차단을 확인했으며 실제 Google Drive·AI·PDF 실기기 성공은 미확인이다.

PC CRM에서 모바일 보고서를 다시 열 때 선택하지 않은 필수 항목이 생기지 않도록 PR #247을 병합하고 정식 릴리스 워크플로 40521839494를 실행했다. 기존 일반 CRM 보고서와 항목이 없는 이전 보고서는 표준 항목을 유지한다. PC 테스트 3123개 통과(기존 제외 2개), CI 통과. Android 0.1.7 build 23fa828a-4c10-4730-b6d8-ee8a7bed62e3은 Expo 빌드 대기 중이다. 두 설치본이 실제 배포되거나 실기기 테스트에 성공한 것으로 미리 간주하지 않는다.

PC 릴리스 워크플로 40521839494는 모든 단계가 성공했으며 CRM v1.92.0을 정식 게시했다. 공개 업데이트 채널 `latest.json`에서도 1.92.0을 확인했다. 이 PC의 설치·재시작은 확인하지 않았다. 모바일 전체 테스트 126개, Functions 전체 테스트 1388개 통과(기존 제외 14개), PC 3123개 통과(기존 제외 2개). 0.1.7 Android 빌드는 2026-10-27 23:40 KST 현재 Expo `IN_QUEUE`이며 완료·서명·실기기 동작은 확인하지 않았다.

0.1.7 (8)은 2026-10-28 00:02:04 KST에 빌드 완료됐다. APK 크기는 118,650,761 bytes, SHA-256은 6a30d80238a4cd2a240e394098dc379adfa55fe4db8fb6cc8f5e91da48f50410이다. APK v2 인증서는 기존 개발 앱과 같다(전체 서명 검증은 아님). 2026-10-28 사용자 재시도의 서버 점검에서 활동사진과 문서함이 모두 404이며 서버의 Google OAuth 범위가 `drive.file`인 것을 확인했다. 기존 폴더별 접근을 위해 Google Picker를 준비했으며 폴더 선택 및 실제 서버 접근은 아직 검증 중이다.

사용자가 Google Picker에서 지정한 두 폴더를 직접 선택한 뒤 기존 앱 재시도는 Drive 사전 확인을 통과했다. 이후 사진 전송용 임시 저장소 오류가 발생했다. 프로젝트의 Firebase 기본 버킷이 실제로 존재하지 않는 것이 확인되어 서울 리전의 별도 비공개 Cloud Storage 버킷을 만들었다. 공개 접근 차단과 통합 버킷 권한을 확인했고, 아직 객체가 없는 상태에서 임시 데이터의 삭제 보존 기간을 0으로 설정했다. 성공한 사진 조각·PDF 임시본은 기존 로직이 삭제하며 미완료 전송은 재시도를 위해 남는다. 앱 서버를 새 버킷으로 변경해 단독 배포하고 익명 접근 차단을 확인했다. 실제 전체 저장 결과는 아직 미확인이다.

2026-10-28 실기기 재시도에서 사진 등록은 성공했으나 사진 조각 저장이 `UPLOAD_NOT_FOUND`로 실패했다. 기존 업로드 레코드는 정상 존재했다. RTDB 에뮬레이터의 독립 연결에서 원인을 재현했다: 트랜잭션이 실제 원격 값보다 먼저 `null`을 전달해 기존 레코드가 없다는 검증이 실행됐다. 서버는 트랜잭션 동안 실제 값 구독을 유지해 초기 값을 받은 뒤 원자적으로 변경하도록 수정했다. 별도 연결의 동시 갱신과 CRM 기존 문서 덮어쓰기 방지 테스트가 통과했다. 실기기 사진·보고서 전체 저장은 재확인이 필요하다.
