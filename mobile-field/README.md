# BRING CARE 현장노트 — 첫 개발 빌드

2026-10-26 · 직원 개별 CRM 계정 사용 확인 · 운영 연결 및 스토어 출시 전

이 폴더는 React Native/Expo 직원용 앱 소스다. 직원 개인 CRM 계정으로 로그인하고 **CRM 고객을 선택해 고객정보의 건물주소를 사용한다. 별도 건물 연결이나 업무 배정은 필요하지 않다.** 2026-10-27 사용자가 Android 0.1.2의 로그인·고객 목록·주소가 정상이라고 확인했다. 0.1.3은 촬영·활동사진 업로드·보고서 작성·Drive PDF 및 CRM 보관을 연결한다. 고객 발송은 PC CRM에서 저장 PDF·수신자를 확인하는 기존 관리자 절차를 이용한다. [최신 연결·배포 기록](../docs/field-mobile/expo-connection-2026-10-27.md)을 참고한다.

Android·iPhone 실기기용 EAS 내부 배포 설정을 추가했다. 2026-10-27 회사 Expo 프로젝트 연결·CLI 인증·두 플랫폼 Firebase 파일 환경변수 등록·Android 서명 지문 등록을 완료했고, **Android 개발 APK 0.1.0 (1) 생성에 성공했다**. [최신 연결 및 Android 빌드 기록](../docs/field-mobile/expo-connection-2026-10-27.md)과 [계정 준비 순서](../docs/field-mobile/device-setup-2026-10-26.md)를 참고한다. `npm run device:check`는 로컬 설정만 읽으며 회사 프로젝트 연결을 확인한다. 기기 인증·운영 API·직원 로그인 성공 판정은 별도로 해야 한다.

새 [Android 0.1.3 (4) 설치 페이지](https://expo.dev/accounts/bringengineerings-team/projects/bring-care-field-notes/builds/74b7b528-1edf-4bfe-8475-ff5d5b13295a)에서 기존 앱 위에 업데이트한다. 0.1.2 고객 조회는 실기기 확인을 마쳤으며, 0.1.3의 실기기 촬영·Drive 권한·PDF 보관 확인은 별도로 구분해 기록한다.

## 이번에 구현한 범위

- Android/iPhone 공통 현장·촬영·사진 확인·보고서·보관함·연결 화면.
- Native 카메라와 시스템 사진 선택, JPEG 변환·최대 변 길이 2,400px 처리, 전·중·후/구역/포함 여부/사진 설명.
- UID별 SQLCipher 보관함. 사진 바이트와 메타데이터·방문 revision을 **한 트랜잭션**으로 보관한다. 키는 SecureStore의 `WHEN_UNLOCKED_THIS_DEVICE_ONLY`에 둔다. SQLCipher가 없는 빌드에서는 일반 SQLite로 대체하지 않고 실패한다.
- 보고서 본문·후속 조치·항목 상태·미실시 사유와 수동 검토 기록. PC의 순수 `work-report-core.js`를 직접 재사용한다. 사진 추가·분류·초안 수정 시 이전 검토 확인을 무효화한다.
- 불러오기·내용 hash 검증·revision 충돌·계정 격리. 전송 상태 변화는 보고서 본문 revision을 바꾸지 않는다.
- 회사 화면에서 고객 선택 → 작업 열기 → 촬영 → 사진 확인 → 보고서 검토 → PDF 보관. 기기 보관함에서 사진만 먼저 업로드할 수도 있다. 예약/완료 키 유지, 서버 offset 조회, 응답 유실 후 재개, 인증 철회 중단, Drive+CRM 확인 전 ready 금지.
- 기존 회사 서버 Drive 연결을 사용한다. 사진은 활동사진/고객명·주소/작업일/전·중·후, PDF는 건물 문서함/현장노트 작업보고서/연도에 비공개 보관한다. 서버가 고객·직원·revision을 재확인하고 JPEG 해시·실제 형식·크기·메타데이터를 검증한다. 생성할 Drive ID를 먼저 고정해 재시도 시 중복을 방지한다.
- 서버 한글 PDF는 선택 사진 최대 24장, 원본 선택 합계 12 MiB, 최종 PDF 12 MiB 이하로 제한한다. PDF 사본은 용량에 맞춰 축소하며 활동사진 원본은 유지한다. CRM 원본과 보관 PDF는 고객 ID로 연결된다. PC CRM 호환 변경은 PR #240 / v1.91.0으로 배포했다.
- 직원 토큰 issuer/audience·취소 확인·native App Check allowlist·현재 CRM access 검사. 활성 사무직 CRM 계정이 `crmCompany/data/customers`의 고객 목록·상세를 조회한다. 고객 ID·표시명·주소만 전달하며 연락처·내부 메모는 제외한다. 주소가 없으면 `주소 미입력`으로 표시하고, 고객 선택 때 최신 고객정보를 다시 읽는다. **Android 앱 하나만 허용하는 별도 `field-mobile` 코드베이스로 읽기 API를 배포했다.**

## 실행

Node 24에서 검증했다. iOS/Android는 SQLCipher가 포함된 자체 네이티브 빌드를 사용한다. `company-preview`는 Metro 없이 실행하는 실기기 내부 배포용이며, `company-development`는 개발 서버에 연결하는 개발용이다. Expo Go는 지원하지 않는다.

```powershell
cd mobile-field
npm ci
npm run typecheck
npm test
npm run web
```

웹 빌드는 합성 사진을 메모리에만 넣으며 새로고침하면 초기화된다. 직원 로그인·실제 사진 업로드를 지원하지 않는다. 네이티브 보관함의 동작을 웹 검증 결과로 대신하지 않는다.

```powershell
npx expo prebuild --no-install
npx expo run:android
# macOS + Xcode 환경
npx expo run:ios
```

로컬 빌드는 Android SDK/JDK와 연결 기기 또는 에뮬레이터, iOS는 macOS/Xcode가 필요하다. 이번에는 회사 Expo 프로젝트의 클라우드 빌드를 사용한다. 무료 플랜과 사용량을 확인했으며 유료 플랜 가입이나 결제는 실행하지 않았다. 사용자가 Android 설치를 완료했고 실기기 연결을 확인 중이다.

앱 ID는 개발용 `kr.co.bringengineering.fieldnotes.dev`이며 CRM 데스크톱과 분리했다. EAS production profile은 의도적으로 구성 검사에서 실패한다. 운영 연결 검증 후 출시 구성을 별도로 완성해야 한다.

## 검증 결과

- TypeScript 검사 통과.
- 모바일·서버 접근 경계·native 어댑터 계약·캡처 실패·로컬 통합·직원 로그인·고객주소 테스트 **110개 통과**(2026-10-27 전체 109개 통과 후 응답 최소화/다른 고객 상세 거부 사례를 추가하고 해당 15개 재실행 통과). Node SQLite로 실제 쿼리·원자성·파일 재열기를 시험했다. Node 테스트 DB와 native mock은 SQLCipher 실기기 검증이 아니다.
- 모바일 배포 범위 테스트 3개, 실제 Node 22에서 단일 함수 export 확인, 운영 API의 인증 없음/위조 토큰 거부·쓰기 차단·예상하지 않은 쿼리 거부를 확인했다. 기존 운영 함수 42개의 소스·상태는 동일하다.
- Functions 전체 테스트 **1,370개 통과, 기존 14개 제외**. TypeScript 서버 빌드 통과.
- 기존 데스크톱 보고서 core 테스트 **24개 통과**.
- Expo Doctor **20/20 통과**.
- Android·iOS Hermes 번들과 웹 번들 생성 성공. APK/IPA 생성·실기기 시험과 구별한다.
- Android prebuild 설정: 카메라 허용, 음성/위치 권한 제외, `allowBackup=false`, `expo.sqlite.useSQLCipher=true` 확인.
- production 환경 구성 차단 확인.
- 브라우저 UI: 가상 현장 열기, 합성 사진 추가·표시·전후 분류, 미저장 본문 이동 차단, 본문·후속 조치 저장, 검토 확인, 대표번호 1551-3873 표시 확인.

사용자의 추가 검증 요청 후 SQLCipher 연결·예약 중 분류 변경·촬영 준비 상태·이미지 자원 해제·응답 크기 검사·저장 중 편집 문제를 수정했다. [검증 상세](../docs/field-mobile/verification-2026-10-26.md)를 참고한다.

후속 연동 점검에서는 실제 loopback HTTP와 SQLite 파일을 함께 사용하는 시험 8개를 추가했다. `npm run test:integration`으로 재실행한다. 인증 검증기와 서버 업무 처리는 시험 대역이므로 실제 Firebase·Drive·CRM 연결 성공을 뜻하지 않는다. [운영 준비 상태와 연동 검증 결과](../docs/field-mobile/integration-verification-2026-10-26.md)를 참고한다.

## 실제 연결 전에 남은 것

1. Android 개발 APK와 직접 설치용 Play Integrity 설정은 완료했다. iOS 기기 attestation·설치본은 준비가 남아 있다. 다운로드한 플랫폼 설정은 `native-config/`에 있고 Git에서 제외한다.
2. `/sites` 고객 목록·주소는 사용자 실기기 확인을 마쳤다. 이전 건물/업무 연결 안내를 다시 요구하지 않는다.
3. 방문 생성·revision 조정·사진 예약·업로드·PDF 보관 계약을 구현했다. 서버의 확인된 revision만 로컬 예약에 연결한다. 기존 읽기 context는 이전 APK 호환을 유지하며 새 기능은 `/recording/context`를 확인한다.
4. 회사 서버 Drive connector와 기존 활동사진·문서함 mapping을 연결했다. PC 개인 토큰을 가져오거나 인증을 우회하지 않는다. 실제 휴대폰에서 서버 Drive 접근을 확인해야 한다.
5. 이미지 검증·Drive 보관·CRM 연결·PDF renderer·수동 재시도 큐를 구현했다. 고객 발송은 PC CRM 관리자 화면을 사용하며 모바일에 NCP 직접 발송은 없다.
6. 실제 Android/iPhone에서 SQLCipher·키 유실·저장소 부족·재시작·사진 회전/HEIC·업데이트를 시험한다. 촬영 캐시 저장 실패 복구, 자동 백업(특히 iOS 제외 정책), 화면 가림·앱 종료, native SDK 동작 검증도 남아 있다.
7. 회사 Google Play/Apple Developer 소유·서명·심사 계정·개인정보 문서 준비.

초기 설계의 ‘별도 암호화 사진 파일+DB’ 대신, 이번 첫 구현은 원본 JPEG를 암호화 DB BLOB에 넣어 메타데이터와 원자적으로 저장한다. 파일과 DB 중 하나만 남는 문제를 줄이기 위한 변경이며, 한 방문 100장·20MiB/장 상한에서 DB 크기/읽기 메모리는 실기기로 검증 후 확정해야 한다. 동시 전송도 우선 한 장으로 제한했다. 사진의 기기 자동 삭제는 아직 수행하지 않는다.

## 의존성 상태

lockfile을 포함한다. Vitest 이슈는 4.1.12로 해소했다. RN Firebase 27.1.0 추가 시 포함된 Firebase 웹 패키지의 오래된 gRPC 전이 의존성은 같은 major의 `@grpc/grpc-js` 1.14.6으로 고정했다. 2026-10-26 최종 audit은 high 8건, critical 0건이며 근본 경고는 기존 Expo 개발 CLI의 `node-forge`/`zod` 2종이다. RN Firebase의 Expo peer 경로가 상위 패키지 집계에 추가됐다. 호환성을 깨는 Expo downgrade나 무검증 주요 버전 교체는 적용하지 않았다. 실제 패치 또는 대체 도구 검증을 출시 조건에 포함하며, 이 개발 서버는 외부 네트워크에 공개하지 않는다.

공식 자료: [Expo SQLite/SQLCipher](https://docs.expo.dev/versions/latest/sdk/sqlite/), [Expo Camera](https://docs.expo.dev/versions/latest/sdk/camera/), [Native App Check](https://rnfirebase.io/app-check/usage).
