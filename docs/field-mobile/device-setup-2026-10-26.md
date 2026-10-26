# Android·iPhone 설치본 준비

2026-10-26. 사용자는 두 플랫폼을 모두 시험하며, Google Play Console과 Apple Developer 계정은 아직 없다고 확인했다. **빌드 설정 검증 완료, APK/IPA 생성·설치 전**이다.

## 준비한 설정

- `company-preview`: Android APK, iPhone 등록 기기용 내부 배포 IPA. 설치 후 Metro 개발 서버 없이 실행한다.
- `company-development`: 같은 회사 연결을 사용하는 개발 클라이언트. 개발 중 Metro에 연결할 때만 사용한다.
- Firebase Android/iOS 설정은 로컬의 Git 제외 파일 또는 EAS 파일 환경변수에서 읽는다. 다른 프로젝트·package/bundle·플랫폼 설정이면 빌드를 중단한다.
- 회사 Expo 소유자와 프로젝트 ID를 명시하지 않으면 회사 빌드를 중단한다. 임의 개인 계정에 자동 연결하지 않는다.
- iOS App Attest entitlement를 `production`으로 설정했다. Firebase App Check는 테스트 빌드도 sandbox App Attest 토큰을 받지 않는다. 이는 출시 완료나 App Check 공급자 등록을 뜻하지 않는다. [Firebase 공식 설정](https://firebase.google.com/docs/app-check/ios/app-attest-provider).
- Android 자동 백업 차단, iOS `NSFileProtectionComplete`, SQLCipher 구성은 유지한다.

## 사용자가 준비할 계정

| 준비 | 용도와 현재 필요한 작업 |
|---|---|
| [Expo 계정](https://expo.dev/signup) | 이 Windows PC에서 양쪽 플랫폼의 클라우드 빌드를 진행할 계정. 회사가 관리할 계정을 준비하고 직접 로그인한다. 현재 CLI는 로그아웃 상태다. 빌드 요청 전에 무료 할당량·요금과 회사 프로젝트 소유자를 확인한다. |
| [Apple Developer](https://developer.apple.com/programs/enroll/) | 이번 EAS iPhone 내부 배포 방식에 필요한 유료 멤버십과 서명. 등록 기기를 추가해야 한다. 연 US$99이며 제공되는 지역은 현지 통화로 결제한다. 법인 조직 가입은 법적 실체·D-U-N-S·계약 권한 등의 확인이 필요하다. 개인사업자는 실제 사업 형태에 맞게 가입 유형을 확인한다. |
| [Google Play Console](https://play.google.com/console/signup) | Google Play 배포와 Play Integrity 구성을 준비한다. 등록비 US$25는 일회성이다. 회사의 실제 사업 형태에 맞는 계정 유형과 신원 확인을 완료한다. APK 설치 자체에는 스토어 가입이 필요하지 않지만, 현재 회사 로그인은 Play Integrity 검증까지 구성해야 한다. |

계정 명의·신원 확인·약관 동의·결제는 사용자가 직접 완료한다. 비밀번호·OTP·복구 코드·서명 키를 채팅에 보내지 않는다. 이 작업에서는 가입·결제·서명 키 생성·빌드 요청을 실행하지 않았다.

공식 안내: [Apple 가입 조건 및 비용](https://developer.apple.com/kr/help/account/membership/program-enrollment/), [Google Play 가입 및 비용](https://support.google.com/googleplay/android-developer/answer/6112435?hl=ko), [Expo 내부 배포](https://docs.expo.dev/build/internal-distribution/).

## 계정 준비 후 연결할 순서

1. 회사 Expo 소유자와 프로젝트를 확인하고 연결한다. 공개 설정 `FIELD_EXPO_OWNER`, `FIELD_EAS_PROJECT_ID`를 로컬과 EAS `preview` 환경에 함께 구성한다. 실제 계정 소유권과 일치하는 값을 사용한다.
2. EAS `preview`에 `FIELD_ANDROID_CONFIG_FILE`, `FIELD_IOS_CONFIG_FILE`을 파일 환경변수로 등록한다. 각각 검증된 `google-services.json`, `GoogleService-Info.plist`이며 서버에서 파일 경로로 제공된다. 로컬 검사에는 기존 `native-config/` 파일을 사용한다. Git에 파일을 추가하지 않는다. [EAS 환경변수](https://docs.expo.dev/eas/environment-variables/).
3. Android 서명 SHA-256·Play Integrity와 Apple 팀·App Attest/DeviceCheck를 연결한다. Play 외부 설치본은 배포 경로에 맞는 지원 여부와 검증 설정을 확인한다. 검증 조건을 임의로 해제해 로그인을 통과시키지 않는다. [Android App Check 설정](https://firebase.google.com/docs/app-check/android/play-integrity-provider).
4. iPhone을 회사 개발자 팀에 등록하고 프로비저닝한다. 개발 앱 ID는 두 플랫폼 모두 `kr.co.bringengineering.fieldnotes.dev`다. 사용자 기기에 설치할 정확한 내부 빌드와 배포 대상을 확인한다.
5. 최신 운영 소스·규칙과 비교한 뒤 새 읽기 API와 필요한 조회 인덱스만 적용하고 두 native 앱 ID를 허용한다. 현재 로컬의 오래된 전체 Functions/rules를 통째로 배포하지 않는다.
6. 빌드 할당량·요금 확인 후 `company-preview`로 양쪽 설치본을 만들고 기기에 설치한다. 직원이 직접 로그인해 본인 현장·관리자 조회·재배정·로그아웃·권한 철회를 확인한다.

회사 현장 조회 이후의 방문 생성·사진 업로드·Drive 보관·PDF 생성·CRM 발송 연결은 별도 구현이 남아 있다. 현재 회사 화면은 읽기 전용이며, 사진/보고서 화면 미리보기와 실제 회사 데이터 저장을 구별한다.

## 이번 검증 결과

| 검사 | 확인 결과 |
|---|---|
| 모바일 TypeScript | 통과 |
| 회사 설정 테스트 | 3개 통과. 파일 환경변수·SDK 식별자 검증·회사 Expo 프로젝트 누락 차단 |
| Expo 회사 설정 introspection | 통과. 두 native 앱 ID·Firebase 프로젝트 일치 |
| 생성될 iOS 설정 | App Attest `production`, 데이터 보호 `NSFileProtectionComplete` |
| Android 설정 | `allowBackup=false` |
| `npm run device:check` | Firebase 파일 일치. Expo 소유자·프로젝트 미연결을 보고하고 종료 코드 1 반환 — 예상된 미준비 상태 |
| 로컬 빌드 도구 | PATH의 Java/ADB 및 확인한 기본 Android SDK/JDK 경로에서 도구를 찾지 못함 |
| 실제 빌드·기기 인증 | 미실행. 서명·App Check 등록·읽기 API 배포·직원 로그인 검증이 남음 |

이전 전체 시험 85개 및 Functions 1,370개 통과 기록은 [직원 로그인 구현 결과](employee-login-2026-10-26.md)에 있다. 이번 설정 변경에서는 관련 3개 시험과 TypeScript·네이티브 설정 생성 검사를 실행했다. 로컬 설정 검사 통과가 클라우드 빌드·실기기 로그인 성공을 의미하지 않는다.
