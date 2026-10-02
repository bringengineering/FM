# BRING FIELD 회사 계정 통합 및 관리번호 자동발급 설계

## 목표

BRING FIELD는 `bringengineering1008@gmail.com`을 대표 관리자 계정과 Google Drive 계정으로 함께 사용한다. 사용자는 한 번의 Google 로그인으로 내부 플랫폼과 Drive 권한을 동시에 얻고, 별도의 Drive 연결 버튼을 반복해서 누르지 않는다. 신규 건물의 내부 관리번호는 주소와 등록 시점을 기준으로 서버가 중복 없이 발급하며 지도, 촬영, Drive 폴더, 광고 묶음에서 동일한 번호를 사용한다.

## 회사 계정 통합

- 대표 관리자 이메일은 `bringengineering1008@gmail.com`으로 고정한다.
- Firebase Google 로그인에서 Drive 권한을 함께 요청하고, 성공한 Google access token을 메모리에만 보관한다.
- BRING FIELD 로그인 계정과 Drive 권한 계정이 대표 관리자 이메일과 다르면 로그인을 중단하고 계정 불일치 안내를 표시한다.
- OAuth access token, 갱신 토큰, 비밀번호는 Realtime Database, IndexedDB, localStorage에 저장하지 않는다.
- 앱이 열린 동안 토큰이 만료되면 Google Identity Services의 `prompt: ""`와 `login_hint`로 기존 동의 계정의 토큰을 조용히 재요청한다. 브라우저 정책이나 Google 세션 만료로 조용한 재연결이 불가능한 경우에만 한 번의 사용자 클릭을 요구한다.
- 상단의 별도 “Google Drive 연결” 버튼은 정상 연결 상태에서 숨기고, 재연결이 필요한 경우에만 “회사 Drive 다시 연결”로 표시한다.
- Drive 루트 폴더는 기존 `1A7JZQLNkuSWMrpAbVcse6EoUeUAKoN3S`를 유지하고, 로그인 직후 쓰기 권한을 검증한다.
- 기존 대표 계정 `dpvld858@gmail.com`은 데이터 소유권 이전이 끝날 때까지 비상 관리자 권한을 유지하되 새 기본 로그인 안내에서는 노출하지 않는다.

## 관리번호 형식

형식은 `BR-WJ-{AREA}-{YY}-{NNNN}`이다. 예: `BR-WJ-MUSIL-26-0001`.

- `BR`: BRING
- `WJ`: 원주
- `AREA`: 도로명주소 또는 지번주소에서 추출한 읍·면·동의 로마자 코드
- `YY`: 등록 연도의 두 자리 숫자
- `NNNN`: 동일한 `AREA`와 `YY` 안에서 증가하는 4자리 순번

대표 구역 코드는 명시적 사전을 사용한다. 예: 무실동 `MUSIL`, 단계동 `DANGYE`, 반곡동 `BANGOK`, 지정면 `JIJEONG`. 사전에 없는 원주 주소는 정규화된 행정구역명으로 안정적인 대문자 영문 코드를 생성하고, 행정구역을 추출할 수 없는 주소는 `ETC`를 사용한다.

## 원자적 발급과 중복 방지

- 클라이언트는 관리번호를 만들거나 수정하지 않는다.
- 등록 요청은 기존 `requestId`를 멱등 키로 사용한다.
- Realtime Database 루트 transaction 안에서 `fieldPlatform/managementNumberCounters/{YY}/{AREA}`를 1 증가시키고 관리번호, 건물, 호실, 매물, 방문, 등록 영수증을 함께 기록한다.
- 같은 `requestId`가 재전송되면 기존 영수증의 번호와 entity ID를 그대로 반환하고 순번을 추가 소비하지 않는다.
- 관리번호는 생성 후 변경할 수 없다. 서버와 보안 규칙 모두 기존 건물의 관리번호 변경을 거부한다.
- 4자리 범위를 초과하면 5자리로 자연 확장해 충돌을 만들지 않는다.

## 화면 및 데이터 흐름

- 건물 등록 화면의 “내부 관리번호” 입력란을 제거하고 “저장 시 자동 발급” 읽기 전용 안내로 바꾼다.
- 주소 중복 확인이 완료되면 예상 구역 코드만 미리 표시하되, 실제 번호는 저장 transaction 결과를 신뢰한다.
- 등록 완료 화면에는 발급된 관리번호를 복사 가능한 형태로 표시한다.
- 지도 projection은 건물의 `managementNumber`를 포함한다.
- 촬영 대상 및 Drive 업로드는 건물 record의 `managementNumber`를 읽는다.
- Drive 건물 폴더 이름은 `{관리번호}_{행정구역}_{건물명}`으로 만든다.
- 광고 묶음의 TXT와 Drive 폴더에도 동일한 `managementNumber`를 사용한다.

## 실패 처리

- 회사 계정이 아니면 `field_company_account_required`로 중단하고 저장된 촬영 파일은 삭제하지 않는다.
- Drive 조용한 재연결 실패는 촬영 자체를 막지 않는다. 파일은 기존 IndexedDB 대기열에 보관하고 사용자가 회사 Drive를 다시 연결하면 자동 재개한다.
- 주소에서 구역을 추출하지 못해도 등록은 `ETC` 코드로 진행한다.
- transaction 충돌은 Firebase transaction 재시도로 해소하며, 최종 실패 시 등록 전체가 기록되지 않는다.

## 보안

- `fieldPlatformAllowedEmails`에 대표 관리자 이메일의 SHA-256 해시를 활성 admin으로 등록한다.
- 관리번호 counter와 registration receipt는 직접 클라이언트 쓰기를 금지하고 등록 callable/서버 transaction만 갱신한다.
- Firebase custom claim과 `fieldPlatform/users/{uid}`의 enabled/role 일치를 계속 요구한다.
- 로그와 데이터베이스에는 OAuth 토큰, 비밀번호, Google 오류 원문을 기록하지 않는다.

## 검증 기준

1. Android Chrome에서 `bringengineering1008@gmail.com`으로 한 번 로그인하면 FIELD와 Drive가 함께 연결된다.
2. 같은 브라우저 세션에서 새로고침해도 동의 화면 없이 Drive가 자동 재연결된다. Google 세션 만료 시에만 다시 연결 버튼이 나타난다.
3. 다른 Google 계정으로 Drive를 연결하려 하면 업로드 전에 계정 불일치로 차단된다.
4. 동일 주소·동일 등록 요청을 재전송해도 관리번호와 entity ID가 바뀌지 않는다.
5. 같은 구역에서 두 건물을 동시에 등록해도 서로 다른 순번이 발급된다.
6. 건물 등록 화면에 수동 관리번호 입력이 없고 완료 후 발급 번호가 표시된다.
7. 지도, 촬영, Drive 폴더, 광고 묶음이 같은 관리번호를 표시한다.
8. 기존 FIELD 전체 테스트, Functions 전체 테스트, 타입 검사와 배포 빌드가 통과한다.
