# Drive 체크리스트 CRM 검토 반영 설계

## 1. 목표

Google Drive의 지정된 온보딩 폴더에 건물 체크리스트 PDF 또는 DOCX가 추가되면 이를 CRM의 `검토 대기` 목록에 올린다. 대표가 내용을 확인하고 승인하기 전에는 정식 건물·호실 데이터를 만들지 않는다. Firebase Functions와 Blaze 요금제는 사용하지 않고 기존 Google Apps Script 자동화를 확장한다.

## 2. 확정 원칙

- GitHub는 소스코드와 설치파일만 보관한다.
- Drive는 PDF·DOCX 원본 파일의 원장이다.
- `bring-fm/crmCompany`는 CRM 구조화 데이터의 원장이다.
- Apps Script는 Drive와 CRM 사이의 유일한 수집·승인 중계자다.
- 원본 파일의 `driveFileId`를 멱등키로 사용하여 같은 파일을 두 번 등록하지 않는다.
- OCR·손글씨·파일명에서 얻은 값은 모두 후보값이며 대표 승인 전에는 정식 데이터가 아니다.
- 전화번호, 임대조건, 출입정보처럼 오인식 위험이 큰 값은 자동 확정하지 않는다.

## 3. 비교한 접근법

### 접근 A — Apps Script 검토 대기 방식(채택)

기존 Drive 자동화를 확장해 후보를 만들고, CRM에서 대표가 승인한다. 추가 요금제 없이 현재 운영방식과 가장 잘 맞고 원본·정식 데이터 경계가 분명하다.

### 접근 B — Drive 자료 즉시 자동등록

구현은 단순하지만 스캔·손글씨 오인식이 정식 데이터에 바로 들어갈 수 있어 제외한다.

### 접근 C — Firebase Functions 정식 저장

가장 강한 서버 트랜잭션을 제공하지만 현재 프로젝트의 Blaze 전환이 필요하고, 기존 Drive 자동화를 중복 구축하게 되어 이번 범위에서는 제외한다.

## 4. 데이터 흐름

1. 시간 기반 Apps Script 트리거가 `CONTRACT_DRIVE_FOLDER_ID`의 PDF와 DOCX만 조회한다.
2. 휴지통 파일, 폴더 밖 파일, 지원하지 않는 MIME 유형은 무시한다.
3. 파일명과 문서 텍스트/OCR에서 건물명·주소·담당자·작성일 후보를 추출한다.
4. Apps Script가 `crmCompany/driveImportCandidates/{driveFileId}`에 후보를 upsert한다.
5. CRM의 `Drive 검토 대기` 화면이 후보를 표시한다.
6. 대표가 값을 수정하고 승인하면 CRM이 기존 Apps Script 웹앱에 승인 요청을 보낸다.
7. Apps Script가 Firebase ID token으로 요청자를 확인하고 `crmCompany/access/{uid}`의 활성 admin인지 재검증한다.
8. Apps Script가 현재 후보와 건물 목록을 다시 읽어 파일 ID·정규화 이름·주소 중복을 검사한다.
9. 한 번의 Firebase multi-location PATCH로 정식 건물, 후보 승인 상태, 감사기록을 함께 저장한다.
10. 거절은 정식 건물을 만들지 않고 후보 상태와 사유만 기록한다.

## 5. 후보 데이터 계약

경로: `crmCompany/driveImportCandidates/{driveFileId}`

```json
{
  "id": "Drive file ID",
  "driveFileId": "Drive file ID",
  "fileName": "원본 파일명",
  "fileUrl": "https://drive.google.com/...",
  "mimeType": "application/pdf",
  "sourceFolderId": "허용된 폴더 ID",
  "sourceModifiedAt": "ISO timestamp",
  "sourceHash": "Drive MD5 checksum; 없으면 driveFileId|수정시각|파일크기의 SHA-256",
  "suggested": {
    "name": "북원로2475번길 93",
    "address": "강원 원주시 북원로2475번길 93",
    "manager": "황우중",
    "type": "다가구",
    "status": "영업후보",
    "unitCount": 0,
    "memo": "Drive 원본 링크와 작성일"
  },
  "confidence": {
    "name": "high",
    "address": "medium",
    "manager": "medium"
  },
  "warnings": ["손글씨 값은 원본 확인 필요"],
  "status": "pending",
  "createdAt": "ISO timestamp",
  "updatedAt": "ISO timestamp",
  "approvedAt": null,
  "approvedByUid": null,
  "crmBuildingId": null,
  "rejectionReason": null
}
```

허용 상태는 `pending`, `approved`, `rejected`, `stale`, `error`로 제한한다. 승인·거절된 후보는 원본 수정 시 자동으로 다시 확정하지 않고 `stale`로 전환해 재검토한다.

## 6. 추출 정책

- DOCX는 기존 `extractDocxText_`를 재사용한다.
- PDF는 Drive 고급 서비스를 이용한 임시 Google Docs OCR을 시도하고 임시 문서는 즉시 휴지통으로 이동한다.
- OCR 실패 시 파일명에서 건물명만 제안하고 `warnings`에 실패 사유를 남긴다.
- 주소의 시·도 정보가 원본에 없으면 자동으로 보충하지 않는다. 파일명과 체크리스트에서 확실히 확인되는 문자열만 저장한다.
- 전화번호, 보증금, 월세, 관리비, 출입 비밀번호는 이번 자동추출 범위에서 제외한다.
- 문서 본문 전체나 OCR 전문은 Firebase에 저장하지 않는다.

## 7. 권한과 보안

- Apps Script는 `ScriptApp.getOAuthToken()`의 Google OAuth 토큰으로 Firebase REST에 접근한다. 실행 계정에는 `bring-fm`의 필요한 Realtime Database IAM 권한만 부여하고 Owner 권한은 장기적으로 제거한다.
- Apps Script 웹앱의 승인·거절 요청은 Firebase ID token, UID, 이메일, `crmCompany/access`의 활성 상태와 역할을 모두 확인한다.
- 승인·거절은 admin만 허용한다. member와 viewer는 후보 조회만 가능하다.
- `driveImportCandidates`의 클라이언트 직접 쓰기는 차단한다.
- 기존 공개 `workflow`, `caseSettings`, `cases`는 이번 기능에서 사용하지 않는다.
- 새 흐름이 안정화된 후 기존 Apps Script 소비자를 인증 경로로 이관하고 공개 쓰기 규칙을 별도 단계에서 폐쇄한다.
- 비밀키·OAuth 토큰·Firebase ID token은 GitHub, Firebase 데이터, 로그, 감사기록에 저장하지 않는다.

Firebase 규칙 경계:

- `driveImportCandidates`: 활성 CRM 계정은 읽기, 모든 클라이언트 쓰기 금지
- 정식 `buildings`: 승인 Apps Script만 생성하고 CRM 클라이언트의 일반 직접 쓰기는 단계적으로 폐쇄
- `auditLogs`: 클라이언트 수정·삭제 금지, Apps Script 승인 트랜잭션만 추가

## 8. CRM 화면

건물 관리에 `Drive 검토 대기` 카드를 추가한다.

- 원본 파일명·수정일·Drive 원본 열기
- 제안 건물명·주소·담당자·유형·상태 수정
- 신뢰도와 경고 표시
- 현재 CRM 건물과 중복 후보 표시
- `승인하여 건물 등록`, `반려` 버튼
- 승인 완료 후 생성된 건물로 이동

admin만 승인·반려 버튼을 볼 수 있다. member와 viewer는 상태와 원본만 조회한다.

## 9. 오류 처리

- Drive 조회 실패: 기존 후보를 삭제하지 않고 마지막 성공시각과 오류만 기록한다.
- OCR 실패: 후보는 유지하고 수동 입력을 요구한다.
- Firebase 쓰기 실패: 승인 성공으로 표시하지 않으며 동일 requestId 재시도를 허용한다.
- 중복 발견: 기존 건물을 덮어쓰지 않고 후보를 `pending`으로 유지하며 중복 대상을 표시한다.
- 원본 삭제: 후보를 물리 삭제하지 않고 `stale`로 표시한다.
- 승인 중 경합: 먼저 승인된 requestId만 성공하고 후속 요청은 동일 결과를 반환한다.

## 10. 기존 자동화와의 공존

- `syncPaymentBuildingsFromOnboarding_()`는 입금관리 호환을 위해 당장 제거하지 않는다.
- 새 후보 동기화는 기존 `caseSettings/paymentBuildings` 전체 PUT을 호출하지 않는다.
- 신규 PDF 처리와 CRM 검토 후보는 별도 함수·별도 경로로 분리한다.
- 기존 DOCX 수집 결과를 새 후보 흐름에서도 재사용하되 입금관리 레지스트리와 서로 덮어쓰지 않는다.

## 11. 테스트와 완료 기준

- 지정 폴더 PDF/DOCX만 후보로 생성된다.
- 동일 Drive 파일 재실행은 후보 1건만 유지한다.
- 원본 수정은 pending 후보를 갱신하고 approved/rejected 후보는 stale로 만든다.
- OCR 실패가 정식 등록으로 이어지지 않는다.
- member/viewer 승인 요청은 거부된다.
- 비활성 계정·이메일 불일치·잘못된 ID token은 거부된다.
- 동일 이름·주소·Drive ID 중복은 정식 건물을 만들지 않는다.
- 승인 성공 시 건물·후보·감사기록이 함께 저장된다.
- 승인 실패 시 셋 모두 부분 저장되지 않는다.
- 기존 DOCX 입금관리 동기화 회귀 테스트가 통과한다.
- 첫 실제 자료 `1K-TSV1UcHFsQwP4YwW2lrKIBfLQZFbih`가 pending으로 수집되고 대표 승인 전 정식 건물 수가 변하지 않는다.

## 12. 배포와 되돌리기

1. 새 Firebase 후보 규칙을 에뮬레이터에서 검증하고 배포한다.
2. Apps Script 후보 동기화 함수를 배포하되 승인 기능은 비활성 플래그로 둔다.
3. 실제 PDF 1건을 pending으로 수집해 필드와 중복판정을 확인한다.
4. CRM 검토 화면을 배포한다.
5. 대표 승인 기능을 활성화하고 첫 건물을 등록한다.
6. 문제가 생기면 승인 기능만 끄고 후보·원본·기존 CRM 데이터는 그대로 보존한다.

이번 범위에서는 기존 `bring-fm-hj` 전체 마이그레이션, 공개 legacy 경로 즉시 폐쇄, 자동 호실 생성, 임대조건 OCR, 자동 광고 게시를 수행하지 않는다.
