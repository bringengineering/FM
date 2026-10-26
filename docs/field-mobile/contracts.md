# 모바일·서버·CRM 연동 계약

2026-10-26 · API 설계 v1 · 아래 경로는 **신규 제안**이며 배포된 endpoint 목록이 아니다.

## 1. 공통 계약

- 논리 base path: `/v1/field-app`. 실제 hostname·Firebase 프로젝트·region은 M0에서 확인한다.
- REST JSON façade를 제안한다. 기존 callable Functions 어댑터를 쓰더라도 아래 검증·응답 의미는 유지한다.
- 요청마다 Firebase ID token과 App Check를 검증하고, 현재 서버 access·현장 할당·행위 권한을 확인한다. companyId·uid·역할·수신 번호·Drive 루트는 요청 body를 신뢰하지 않는다.
- JSON 최대 128 KiB. unknown field는 거부하고 원본 입력을 오류에 반사하지 않는다. 사진 바이트는 JSON/base64로 보내지 않는다. chunk는 별도 binary endpoint만 사용한다.
- ID는 opaque 문자열, 길이 1~120, `[A-Za-z0-9_-]`. UUID v4 등을 사용하고 이메일·전화·주소를 ID에 넣지 않는다. source ID의 기존 형식은 서버 어댑터가 따로 검증한다.
- date는 유효한 `YYYY-MM-DD`, instant는 RFC3339, 보고 기준 timezone은 `Asia/Seoul`. 서버 createdAt과 기기 claimedCapturedAt을 구별한다.
- JSON 변경 요청에는 `Idempotency-Key`를 사용한다. 서버가 actor·행위·대상·정규화 body hash에 묶어 보관한다. 같은 키·다른 body는 409, 같은 키·같은 body는 원래 resource/operation을 반환한다.
- 편집에는 `expectedRevision`, 확정본·미리보기에는 content/artifact hash를 요구한다. 최신 기록과 불일치하면 409이며 서버가 임의 병합하지 않는다.
- 성공은 200/201, 비동기는 202 + operationId. 서버가 실제로 보관한 단계보다 앞서 완료라고 반환하지 않는다.

권한 표기: `writer`는 관리자 또는 현재 작업에 허용된 member, `admin`은 현재 회사의 관리자다. 읽기 또한 같은 방문·보고서 접근 범위에 제한한다.

## 2. API 목록

| ID | 메서드·경로 | 권한 | 입력·결과 요약 |
|---|---|---|---|
| F01 | `GET /context` | writer | actor 표시 정보, capabilities, schema·한도·연결 상태 |
| F02 | `GET /jobs` | writer | 날짜·cursor 기반 허용 현장 목록, 한 페이지 50 이하 |
| F03 | `POST /visits` | writer | canonical buildingId/workOrderId로 촬영 방문 시작 |
| F04 | `GET /visits/{visitId}` | writer | 현재 방문 revision·구역·사진 상태 |
| F05 | `PATCH /visits/{visitId}` | writer | expectedRevision으로 허용된 메모·작업일 갱신 |
| F06 | `POST /visits/{visitId}/photos` | writer | photoId·구역·단계·크기·hash 예약, uploadId 반환 |
| F07 | `PUT /uploads/{uploadId}/chunks` | writer | offset·range와 바이트 전송, confirmed offset 반환 |
| F08 | `GET /uploads/{uploadId}` | writer | 서버가 확인한 receivedBytes·검증·보관 단계 |
| F09 | `POST /uploads/{uploadId}/complete` | writer | finalize 작업 요청, 동일 operation 반환 |
| F10 | `PATCH /visits/{visitId}/photos/{photoId}` | writer | expectedRevision으로 구역·단계·보고서 포함 여부 변경 |
| F11 | `POST /visits/{visitId}/draft-previews` | writer | 선택된 ready 사진·허용 메모만으로 AI 초안, 저장과 분리 |
| F12 | `POST /visits/{visitId}/report-revisions` | writer | 기존 core 검증 후 불변 보고서 revision 확정 |
| F13 | `POST /report-revisions/{revisionId}/artifacts` | writer | 서버 PDF 생성·Drive 보관·CRM 연결 operation |
| F14 | `GET /operations/{operationId}` | writer | 작업 상태·다음 동작·안전 원인 코드 |
| F15 | `POST /report-revisions/{revisionId}/review-requests` | writer | 관리자 확인 요청, 고객 메시지 전송 없음 |
| F16 | `POST /artifacts/{artifactId}/delivery-previews` | admin | 수신자·문구·PDF binding 검증 후 짧은 previewId |
| F17 | `POST /artifacts/{artifactId}/deliveries` | admin | previewId 최종 확인, 공통 claim 뒤 단일 발송 의도 접수 |
| F18 | `GET /deliveries/{deliveryId}` | writer | 같은 보고서의 접수·전달 결과 조회, 번호 마스킹 |

모든 경로에는 `/v1/field-app` prefix를 붙인다. 목록·operation·delivery 조회에도 소유·회사·할당 검사와 rate limit이 있다. F18은 조회만 가능하며 직원에게 발송·재발송 권한을 부여하지 않는다. 실제 구현에 클라이언트 직접 Drive 업로드나 직접 NCP 발송 API를 추가하지 않는다.

## 3. 핵심 요청·응답 예시

아래 ID·번호는 예시다. 실제 개인정보·인증 값·서버 URL은 포함하지 않는다.

### F01 context

```json
{
  "schemaVersion": 1,
  "actor": {"displayName": "예시 직원", "role": "member"},
  "capabilities": {
    "capture": true,
    "writeReport": true,
    "archiveReport": true,
    "requestReview": true,
    "sendCustomerReport": false
  },
  "connections": {"drive": "ready", "completionTemplate": "ready"},
  "limits": {"photoBytes": 20971520, "photosPerVisit": 100, "pdfBytes": 12582912}
}
```

capabilities는 표시용 힌트다. 실제 F03~F18은 매번 서버에서 다시 판정한다. role 문자열·이메일 도메인만으로 사용자를 활성화하지 않는다.

### F03 방문 시작

```json
{
  "visitId": "visit_example",
  "buildingId": "building_example",
  "workOrderId": "work_example",
  "workDate": "2026-10-26",
  "kind": "common"
}
```

building↔workOrder 관계, 배정, 선택한 작업 종류, 회사 범위, 작업일 허용 범위를 서버가 확인한다. 기존 ID를 잘못 연결하거나 종료·접근 불가 작업이면 저장하지 않는다. 임시 현장을 만들 필요가 있으면 관리자 승인 경로를 따르며 F03이 고객·건물 원장을 임의 생성하지 않는다.

### F06 사진 예약

```json
{
  "expectedRevision": 1,
  "photoId": "photo_example",
  "itemKey": "entrance",
  "phase": "before",
  "claimedCapturedAt": "2026-10-26T10:01:00+09:00",
  "mimeType": "image/jpeg",
  "size": 3145728,
  "sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
}
```

```json
{
  "photoId": "photo_example",
  "uploadId": "upload_example",
  "visitRevision": 2,
  "state": "reserved",
  "chunkBytes": 1048576,
  "receivedBytes": 0
}
```

photoId는 기기 재시작 뒤에도 유지한다. 같은 photoId에 다른 바이트·다른 방문을 넣을 수 없다. 업로드 session URL·서버 storagePath·Google 토큰을 응답하지 않는다. declared sha256·MIME·size는 참고/일치 검사용이며 실제 파일 검증을 대신하지 않는다.

### F07 chunk

```text
Content-Type: application/octet-stream
Content-Range: bytes 0-1048575/3145728
Idempotency-Key: chunk_example_0
```

body는 정확히 해당 range의 binary다. 서버는 upload 소유권·lease·총 크기·range·offset을 검증하고, 같은 offset+바이트 재전송을 중복 반영하지 않는다. 다른 바이트 재전송은 409다. 병렬 전송은 파일 간 최대 2개, 한 파일 내부는 순차다. 한도 초과를 body 전부 읽은 뒤에만 검사하지 않으며 actual decoded 한도는 finalize에서 따로 확인한다.

```json
{"uploadId":"upload_example","receivedBytes":1048576,"state":"uploading"}
```

이 응답은 Drive 보관 성공을 의미하지 않는다. offset은 클라이언트 누적치가 아닌 서버 확인값이다. 세션 만료·토큰 만료·권한 거부는 구별하고, 업로드 재예약 시에도 같은 photo binding을 유지한다.

### F09 finalize / F14 작업 조회

```json
{"operationId":"operation_photo_example","state":"validating"}
```

```json
{
  "operationId":"operation_photo_example",
  "state":"succeeded",
  "result":{"photoId":"photo_example","photoState":"ready","visitRevision":3},
  "safeErrorCode":null
}
```

`ready`는 서버 바이트·decoded 크기 검증, Drive 보관·무결성 확인, CRM 연결이 모두 완료됐을 때만 반환한다. 문서/사진 원본은 임의 공개 URL로 반환하지 않고 별도 인증 미리보기 방식으로 제공한다.

### F12 보고서 revision

```json
{
  "expectedRevision":3,
  "reportId":"report_example",
  "baseReportUpdatedAt":null,
  "kind":"common",
  "summary":"[예시] 실제로 수행하고 확인한 작업 내용을 입력합니다.",
  "followUp":"[예시] 필요한 후속 확인을 입력합니다.",
  "items":[
    {"key":"entrance","status":"recorded","note":"[예시] 작업 기록","beforePhotoIds":["photo_example"],"duringPhotoIds":[],"afterPhotoIds":[]}
  ]
}
```

예시는 항목 한 개만 발췌했다. 실제 필수 항목 전체와 종류별 상태는 기존 `work-report-core.js`를 따른다. `recorded`는 완료가 아니다. 건물명·수신인·연락처·Drive ID는 입력받아 덮어쓰지 않고 서버에서 source에 결합한다. 기존 report를 갱신할 때 `baseReportUpdatedAt`이 맞아야 한다.

summary/followUp은 기존 2,000자 한도를 유지한다. 입력 문자열은 그대로 HTML로 렌더링하지 않고 기존 encoding/sanitizer 경계를 유지한다. 확정 revision은 정규화된 내용·순서가 고정된 사진 ID·schemaVersion·hash로 묶는다.

```json
{"reportId":"report_example","revisionId":"revision_example","contentHash":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","state":"confirmed"}
```

### F13 PDF·보관

입력은 revision ID와 기대 contentHash만 허용한다. 클라이언트가 PDF 바이트·HTML·외부 이미지 URL·회사 공급자 연락처를 바꿔 보낼 수 없다. 서버는 허용된 source와 고정 템플릿으로 생성한다.

```json
{"operationId":"operation_pdf_example","state":"rendering"}
```

최종 F14 결과에 artifactId와 revisionId, sha256, size, `archiveState: ready`를 제공한다. Drive ID·보고서 `updatedAt`은 기존 제한된 CRM 메타데이터 형식으로 연결한다. 사진 하나라도 읽지 못한 PDF를 정상 저장본으로 확정하지 않는다. 동일 revisionId+renderVersion의 재요청은 같은 작업·artifact를 재사용한다.

### F16 관리자 발송 미리보기

```json
{"expectedRevisionId":"revision_example","expectedArtifactHash":"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"}
```

```json
{
  "previewId":"preview_example",
  "artifactId":"artifact_example",
  "revisionId":"revision_example",
  "recipient":{"label":"샘플빌딩 건물주님","maskedPhone":"010-****-1234"},
  "templateCode":"BRINGCOMPLETIONREPORTV3",
  "supportPhone":"1551-3873",
  "buttonName":"결과보고서 확인",
  "linkTtlDays":7,
  "expiresAt":"2026-10-26T10:12:00+09:00"
}
```

실제 응답은 검증된 본문 변수·표시 내용도 포함한다. 안전 링크 토큰·서비스 키는 일반 로그·DB에 넣지 않는다. previewId는 짧은 시간(제안 2분) 동안 actor·artifact·revision·최신 고객 binding·템플릿 fingerprint에 묶고, 발송 시 다시 확인한다. 고객/번호 변경, 템플릿 재검수, 저장본 변경, 관리자 권한 취소는 미리보기를 무효화한다.

### F17 실제 발송 의도 접수

```json
{"previewId":"preview_example","expectedRevisionId":"revision_example"}
```

앱이 phone·customerId·templateCode·expiry·본문을 임의로 바꾸는 필드를 받지 않는다. 서버는 기존 고객·보관 PDF에서 결정한다. PC·모바일의 공통 원자적 claim을 획득하기 전에는 공급자를 호출하지 않는다. claim은 artifact+revision+수신 binding+행위로 묶고, request key 보관기간이 지나도 해당 저장본의 기존 발송 기록을 무시하지 않는다.

```json
{"deliveryId":"delivery_example","state":"requested","artifactId":"artifact_example"}
```

요청 취소/timeout은 공급자가 받지 않았다는 증거가 아니다. 외부 요청이 시작된 뒤 결과가 불명확하면 `unknown`으로 보존하고 F18 조회만 한다. 이 설계가 공급자의 실제 전달을 수학적으로 exactly-once 보장한다고 표현하지 않는다. 목표는 **중복 발송 의도의 차단과 불명 결과의 재전송 금지**다.

F18의 상태는 `requested/processing/delivered/failed/unknown`이다. 알려진 message ID가 있으면 조회하고, ID조차 회수하지 못했다면 사용자에게 확인 필요 상태를 유지한다. 새 키로 재요청하거나 자동 SMS 대체하지 않는다. 확실한 실패의 수동 재시도는 별도 관리자 확인·기록이 필요하며 첫 버전 기본 동작이 아니다.

## 4. 오류 계약

```json
{"error":{"code":"REVISION_CONFLICT","message":"최신 내용을 확인해 주세요.","retryable":false,"stage":"report-confirm"},"requestId":"request_example"}
```

| HTTP | 안전 code 예시 | 앱 동작 |
|---|---|---|
| 400 | INPUT_INVALID / PHOTO_INVALID / REPORT_INVALID | 해당 항목 수정, 바이트·원문 반사 없음 |
| 401 | AUTH_REQUIRED / SESSION_EXPIRED | 연결 재확인, 큐 보존 |
| 403 | ACCESS_DENIED / ASSIGNMENT_REQUIRED | 동작 중단, 권한 우회 없음 |
| 404 | RESOURCE_NOT_FOUND | 다른 사용자 자료 존재를 노출하지 않음 |
| 409 | REVISION_CONFLICT / IDEMPOTENCY_CONFLICT / DELIVERY_ALREADY_REQUESTED | 최신본·기존 요청 조회 |
| 413 | PHOTO_TOO_LARGE / PDF_TOO_LARGE | 크기 조정 안내, 원본 보존 |
| 422 | PHOTO_NOT_READY / ARTIFACT_NOT_READY | 미완료 단계로 이동 |
| 429 | RATE_LIMITED | Retry-After, 제한된 지연 재시도 |
| 503 | DRIVE_UNAVAILABLE / TEMPLATE_UNAVAILABLE | 저장된 원본 보존, 자동 발송 금지 |

`retryable`은 업로드·PDF 작업의 명확한 일시 실패에만 적용한다. delivery unknown에는 generic 재시도 정책을 적용하지 않는다. 네트워크 요청 로그와 crash SDK에도 인증 헤더·고객 원문·문서/업로드 URL을 남기지 않는다.

## 5. 상태 소유와 commit 지점

| 상태/전환 | 쓰기 소유자 | 성공 판단 |
|---|---|---|
| 로컬 파일·대기 큐 | 해당 UID의 앱 | 파일·큐의 기기 확정 |
| 업로드 offset | 서버 업로드 게이트웨이 | 실제 수신 바이트·세대 일치 |
| 사진 ready | 검증·Drive 작업자 | 실제 파일 검증 + Drive + CRM 연결 |
| ReportRevision confirmed | 인증된 서버 명령 | expectedRevision·core 검증·hash 일치 |
| Artifact ready | 서버 PDF 작업자 | PDF 전체 + Drive 무결성 + canonical 문서 연결 |
| ReviewRequest requested | 작성 권한 사용자/서버 | 관리자 검토 대기, 외부 발송 없음 |
| Delivery claim·status | 공통 발송 서버 | 원자적 claim, 공급자 응답/조회 |

각 작업은 최소 한 번 실행될 수 있음을 전제로 같은 대상·세대·hash에서 멱등하게 만든다. 권한은 작업을 예약할 때뿐 아니라 Drive commit·PDF 확정·외부 발송 직전 다시 확인한다. 접근이 취소된 직원의 대기 작업을 서비스 계정 권한만으로 계속 완료하지 않는다. 조직의 명시적 관리자 인수는 별도 감사 기록으로 처리한다.

## 6. CRM 호환·발송 활성화 조건

- ReportRevision→기존 workReports 변환에서 kind/itemKey/status/photo caption·Drive 링크 정규화·workDate·updatedAt을 일치시킨다.
- 기존 savedCustomerDocument의 kind=workReport, customerId, recipientPhone, reportId, reportUpdatedAt, sha256, size 형식을 유지한다. 이를 무시하는 별도 모바일 보고서 타입을 만들지 않는다.
- 직원에게 전체 고객 연락처 원장·securityAssets·내부 원가·계좌·열쇠 데이터를 다운로드하지 않는다. API projection만 사용한다.
- PC와 모바일이 같은 artifact를 동시에 요청하는 시험, 공급자 요청 직후 장애 시험을 통과하기 전에는 모바일 고객 발송을 활성화하지 않는다.
- 전환에 필요하면 최소 PC 버전·서버 capability로 단계적으로 열고, 오래된 PC의 우회 경로는 별도 검토한다. 운영 DB 규칙 변경은 사용자 승인·백업·롤백 후에만 수행한다.
