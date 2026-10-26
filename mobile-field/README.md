# BRING CARE 현장노트 — 첫 개발 빌드

2026-10-26 · 직원 개별 CRM 계정 사용 확인 · 운영 연결 및 스토어 출시 전

이 폴더는 기존 HTML 화면 미리보기와 별개인 React Native/Expo 앱 소스다. 직원 로그인·담당 현장 조회 클라이언트와 읽기 API를 구현했고, 회사 Firebase에 Android/iOS 개발 앱을 등록했다. 기본 실행은 가상 현장 미리보기다. 회사 연결은 기기 인증 설정·API 배포·실기기 시험 전이며, Drive 업로드·서버 PDF·고객 발송은 아직 연결하지 않았다. [최신 로그인·조회 구현 결과](../docs/field-mobile/employee-login-2026-10-26.md)를 참고한다.

## 이번에 구현한 범위

- Android/iPhone 공통 현장·촬영·사진 확인·보고서·보관함·연결 화면.
- Native 카메라와 시스템 사진 선택, JPEG 변환·최대 변 길이 2,400px 처리, 전·중·후/구역/포함 여부/사진 설명.
- UID별 SQLCipher 보관함. 사진 바이트와 메타데이터·방문 revision을 **한 트랜잭션**으로 보관한다. 키는 SecureStore의 `WHEN_UNLOCKED_THIS_DEVICE_ONLY`에 둔다. SQLCipher가 없는 빌드에서는 일반 SQLite로 대체하지 않고 실패한다.
- 보고서 본문·후속 조치·항목 상태·미실시 사유와 수동 검토 기록. PC의 순수 `work-report-core.js`를 직접 재사용한다. 사진 추가·분류·초안 수정 시 이전 검토 확인을 무효화한다.
- 불러오기·내용 hash 검증·revision 충돌·계정 격리. 전송 상태 변화는 보고서 본문 revision을 바꾸지 않는다.
- 서버 연동용 전송 어댑터와 단일 실행 큐. 예약/완료 키 유지, 서버 offset 조회, 응답 유실 후 재개, 인증 철회 중단, Drive+CRM 확인 전 ready 금지. **현재 UI에는 활성 연결하지 않았다.**
- 직원 토큰 issuer/audience·취소 확인·native App Check allowlist·현재 CRM access 검사. `fieldMobileApi` 읽기 함수 export와 회사 로그인·현장 목록/상세 화면을 추가했다. 기존 `workOrders.assigneeUid`로 담당자를 확인한다. **운영 API 배포는 하지 않았다.**

## 실행

Node 24에서 검증했다. iOS/Android 빌드는 Expo Go 대신 SQLCipher가 포함된 Development Build를 사용한다.

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

Android SDK/JDK와 연결 기기 또는 에뮬레이터, iOS는 macOS/Xcode가 필요하다. 이 PC에서는 네이티브 설치 파일을 빌드하거나 실기기를 연결하지 않았다. 회사 개발자 계정과 EAS 프로젝트를 연결하거나 유료 빌드를 요청하지 않았다.

앱 ID는 개발용 `kr.co.bringengineering.fieldnotes.dev`이며 CRM 데스크톱과 분리했다. EAS production profile은 의도적으로 구성 검사에서 실패한다. 운영 연결 검증 후 출시 구성을 별도로 완성해야 한다.

## 검증 결과

- TypeScript 검사 통과.
- 모바일·서버 접근 경계·native 어댑터 계약·캡처 실패·로컬 통합·직원 로그인 테스트 **85개 통과**. Node SQLite로 실제 쿼리·원자성·파일 재열기를 시험했다. Node 테스트 DB와 native mock은 SQLCipher 실기기 검증이 아니다.
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

1. Android/iOS 개발 앱 등록은 완료했다. 회사 서명·개발자 설정에 맞는 기기 attestation과 설치본을 준비해야 한다. 다운로드한 플랫폼 설정은 `native-config/`에 있고 Git에서 제외한다.
2. CRM 업무지시의 `assigneeUid`를 사용하는 최소 조회 projection을 구현했다. 기존 field-v2의 공유 `operatorId`는 사용하지 않는다. 실제 직원의 현장 조회는 아직 시험하지 않았다.
3. 읽기 API 배포와 `assigneeUid` 인덱스 적용, 방문 생성·revision 조정·사진 예약 계약 구현. 현재 업로드 client는 `reservationRevision`이 없으면 요청을 거부한다. 로컬 revision을 대신 넣지 않는다.
4. 회사가 허용한 서버 Drive connector와 활동사진·문서함 mapping. 기존 PC의 개인 토큰을 공용 서버 토큰으로 전환하지 않는다.
5. 서버 이미지 검증·Drive 보관·CRM 연결·PDF renderer와 복구 작업자, 관리자 검토/공통 발송 claim. 이 코드에 실제 NCP 메시지 API 호출은 없다.
6. 실제 Android/iPhone에서 SQLCipher·키 유실·저장소 부족·재시작·사진 회전/HEIC·업데이트를 시험한다. 촬영 캐시 저장 실패 복구, 자동 백업(특히 iOS 제외 정책), 화면 가림·앱 종료, native SDK 동작 검증도 남아 있다.
7. 회사 Google Play/Apple Developer 소유·서명·심사 계정·개인정보 문서 준비.

초기 설계의 ‘별도 암호화 사진 파일+DB’ 대신, 이번 첫 구현은 원본 JPEG를 암호화 DB BLOB에 넣어 메타데이터와 원자적으로 저장한다. 파일과 DB 중 하나만 남는 문제를 줄이기 위한 변경이며, 한 방문 100장·20MiB/장 상한에서 DB 크기/읽기 메모리는 실기기로 검증 후 확정해야 한다. 동시 전송도 우선 한 장으로 제한했다. 사진의 기기 자동 삭제는 아직 수행하지 않는다.

## 의존성 상태

lockfile을 포함한다. Vitest 이슈는 4.1.12로 해소했다. RN Firebase 27.1.0 추가 시 포함된 Firebase 웹 패키지의 오래된 gRPC 전이 의존성은 같은 major의 `@grpc/grpc-js` 1.14.6으로 고정했다. 2026-10-26 최종 audit은 high 8건, critical 0건이며 근본 경고는 기존 Expo 개발 CLI의 `node-forge`/`zod` 2종이다. RN Firebase의 Expo peer 경로가 상위 패키지 집계에 추가됐다. 호환성을 깨는 Expo downgrade나 무검증 주요 버전 교체는 적용하지 않았다. 실제 패치 또는 대체 도구 검증을 출시 조건에 포함하며, 이 개발 서버는 외부 네트워크에 공개하지 않는다.

공식 자료: [Expo SQLite/SQLCipher](https://docs.expo.dev/versions/latest/sdk/sqlite/), [Expo Camera](https://docs.expo.dev/versions/latest/sdk/camera/), [Native App Check](https://rnfirebase.io/app-check/usage).
