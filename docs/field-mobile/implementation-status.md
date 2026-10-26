# 2026-10-26 첫 구현 상태

사용자가 기능 미리보기 후 개발 진행을 요청했고, 직원마다 별도 CRM 계정을 사용한다고 확인했다.

산출물은 [`mobile-field/`](../../mobile-field/README.md)와 비배포 서버 접근 검사 모듈이다. **M0 일부 확인 + M1/M2의 로컬 개발 기반**까지이며, 설계의 M1/M2/M3/M4/M5 완료 조건을 충족했다는 뜻은 아니다.

## 확인한 연결 경계

| 대상 | 확인 | 남은 확인 |
|---|---|---|
| Firebase 소스 기준 | `release/firebase-targets.json`은 primary bring-fm, bring-fm-hj retired, 기존 field 함수 다수 archived | Auth·원장·할당을 실제 직원 흐름에서 확인 |
| Firebase 앱 목록 | 기존 CLI로 bring-fm 앱 목록만 읽음. 웹 앱 한 개, native 앱 없음 | Android/iOS 등록·native attestation |
| 직원 식별 | 사용자: 직원별 개별 CRM 계정 | 업무/팀 레코드와 UID의 실제 대응 |
| 기존 field-v2 | 공유 계정 아래 선택된 operatorId는 인증 자격이 아니라는 소스 주석 확인 | 모바일 권한에 operatorId를 재사용하지 않음 |
| 네이티브 실행 도구 | Node 24 제공, 현재 PATH에 JDK/adb 없음, Windows 환경 | Android SDK/기기, iOS Mac/Xcode 또는 회사 빌드 환경 |
| Drive·스토어 | 운영 권한/서명/폴더 변경 없음 | 회사 서버 connector, 앱스토어 소유·서명 |

## 구현과 검증의 경계

촬영 API와 암호화 보관 코드를 작성하고, 실제 SQLite 쿼리의 트랜잭션·원본 hash·UID 격리·재열기·충돌 시험을 완료했다. Android 네이티브 프로젝트 설정 생성은 통과했고 양쪽 OS의 JS/Hermes export도 통과했다. **네이티브 실행, 장치 재부팅, 실사진 처리, SQLCipher 파일 암호화 검증을 실제 기기에서 수행한 결과는 아니다.**

서버 연동 어댑터는 테스트 서버 응답으로 확인했다. 실제 배포된 API·Drive·CRM·공급자에 대한 성공 결과가 아니다. 고객 발송·보고서 저장·템플릿 변경·권한 변경·기존 앱 배포는 없다.

33개 신규 테스트, 기존 보고서 core 24개, 타입 검사, Expo Doctor 20/20과 UI 확인을 완료했다. 이 수를 원래 설계의 수용 시험 30개가 완료됐다는 의미로 사용하지 않는다.

## 다음 구현 순서

개별 계정의 native 앱 등록/attestation과 회사 권한·할당 projection → 방문·사진 저장 API → 서버 Drive/PDF/CRM 보관 → 관리자 검토와 PC·모바일 공통 발송. 운영 데이터·권한·비용을 변경해야 하는 단계는 실제 필요한 대상과 범위를 확인한 뒤 진행한다. 미완료 보고서를 성공으로 보여 주는 연결 대체 로직은 넣지 않는다.
