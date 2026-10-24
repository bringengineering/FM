# BRING FIELD 개발 인수인계

## 위치와 실행 주소

- Git 브랜치: `codex/bring-field-platform`
- 운영 FIELD: <https://bring-fm.web.app/field>
- 기존 FM/CRM: <https://bringengineering.github.io/FM/>
- FIELD 프런트엔드: `company-site/app/field`
- Firebase Functions: `functions/src`
- Realtime Database 규칙: `database.rules.json`
- Firebase Hosting/Functions 설정: `firebase.json`

## 현재 구현 범위

- 승인된 내부 직원 Google 로그인
- 관리계약 건물 등록과 주소 기반 내부 관리번호 자동 발급
- 네이버 지도용 관리 건물 projection
- 휴대전화 사진·영상 촬영 및 사진첩 다중 추가
- 기기 IndexedDB 대기열과 Firebase/Google Drive 업로드
- 휴대전화 전체 업로드 현황 실시간 표시
- 건물주 전달사항과 서버 자동저장 초안
- 광고 검토 및 광고 묶음 생성
- Google Drive 폴더·미디어 동기화 및 복구 작업

## 기존 CRM과 연결할 때

기존 CRM은 저장소 루트의 `index.html`과 Firebase `/cases`, `/caseSettings`를
사용합니다. FIELD는 `/fieldPlatform`을 사용합니다. CRM을 FIELD에 연결할 때 기존
공개 rules를 그대로 재사용하지 말고, `fieldPlatform/users`의 내부 직원 권한과
동일한 인증 경계를 적용해야 합니다.

권장 연결 키는 다음과 같습니다.

- CRM case의 건물 연결: FIELD `buildingId` 및 `managementNumber`
- CRM 고객/건물주 연결: 별도 server-owned 관계 노드
- CRM 문의에서 현장 촬영 생성: FIELD `visitId` 및 `captureSessionId`
- 광고 자료 연결: FIELD `listingId` 및 최신 `adPackageId`

개인 연락처와 CRM 상담 내용은 `mapProjections`나 공개 광고 데이터에 복사하지
않습니다.

## 검증 명령

```powershell
cd company-site
pnpm.cmd test:field:run
pnpm.cmd typecheck:field
pnpm.cmd build

cd ..\functions
pnpm.cmd test
pnpm.cmd build
```

Functions의 권장 Node 버전은 22입니다. Google Drive 비밀값은 Git에 없으며
Firebase Secrets의 `DRIVE_CLIENT_ID`, `DRIVE_CLIENT_SECRET`,
`DRIVE_REFRESH_TOKEN`, `DRIVE_ROOT_FOLDER_ID`, `DRIVE_ROOT_MODE`를 사용합니다.
