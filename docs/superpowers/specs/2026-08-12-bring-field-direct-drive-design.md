# BRING FIELD Google Drive 직접 저장 설계

## 목표

BRING FIELD PWA에서 회사 Google 계정으로 로그인한 직원이 휴대전화 카메라로 사진과 영상을 촬영하면, Firebase 유료 Storage나 Cloud Functions를 거치지 않고 회사 Drive 루트 폴더 `1A7JZQLNkuSWMrpAbVcse6EoUeUAKoN3S` 아래에 자동 정리한다. 같은 화면에서 당근·네이버 부동산용 설명과 선택 미디어를 광고 묶음으로 생성한다.

## 경계

- Firebase 프로젝트는 회사 소유 `bring-fm` 하나만 사용한다.
- Firebase Authentication, Realtime Database, Hosting은 유지한다.
- Cloud Storage와 Cloud Functions는 이 흐름에서 사용하지 않는다.
- Drive 권한은 `drive.file` 최소 범위로 요청한다. 직원은 최초 연결 시 회사 계정으로 한 번 승인한다.
- Drive 루트는 고정 ID를 사용하되, 앱이 만든 파일과 폴더만 조회·수정한다.
- OAuth access token은 메모리에만 두고 Realtime Database, IndexedDB, localStorage에 저장하지 않는다.

## 폴더 구조

```text
BRING 광고 매물/
  원주시-{구역}/
    {건물명}_{도로명주소}/
      {호실}/
        {YYYY-MM-DD}_{촬영세션}/
          01_외관/
          02_진입로/
          03_주차/
          04_공용현관/
          05_복도계단/
          06_분리수거/
          07_방전체/
          08_채광/
          09_주방/
          10_욕실/
          11_옵션수납/
          12_보일러설비/
          13_하자근거/
          14_세로영상/
          광고묶음/
```

폴더와 파일에는 `appProperties`로 `bringManaged`, `entityType`, `buildingId`, `unitId`, `listingId`, `captureSessionId`, `mediaId`, `zone`을 기록한다. 이름 변경과 동명이 있어도 ID와 속성으로 재사용하여 중복 생성을 막는다.

## 업로드

- 5MiB 이하는 multipart 업로드, 그보다 큰 사진·영상은 Drive resumable upload를 사용한다.
- resumable 세션 URL과 offset은 해당 파일의 IndexedDB 큐 레코드에 저장해 네트워크 단절 후 재개한다.
- 업로드 완료 응답의 file ID, size, md5Checksum을 검증한다.
- Drive file ID가 확정되면 Realtime Database `fieldPlatform/media/{mediaId}`에 `driveSyncState: complete`, `driveFileId`, `uploadState: finalized`를 기록한다.
- 같은 mediaId의 재시도는 Drive `appProperties` exact query로 기존 파일을 찾아 재사용한다.

## Firebase 직접 기록

Blaze가 없는 환경에서도 동작하도록 관리자/배정 직원에게 제한된 직접 쓰기를 허용한다.

- 촬영 세션과 방문은 한 번의 root `update`로 만든다.
- 미디어는 본인 소유 open 세션에만 생성할 수 있다.
- 광고 묶음은 해당 listing에 연결되고 승인된 Drive 미디어만 포함한다.
- 모든 직접 쓰기는 기존 custom claim과 `fieldPlatform/users/{uid}` enabled/role 일치 검사를 통과해야 한다.
- 서버 전용 Drive job·lease·secret 경로는 계속 쓰기 금지한다.

## 광고 묶음

검토 화면은 Realtime Database에서 listing·building·unit·media를 읽는다. 대표 사진 순서와 포함 여부를 선택하면 브라우저에서 다음 파일을 만든다.

1. `01_당근_광고문구.txt`
2. `02_네이버_매물정보.txt`
3. `03_매물요약.txt`
4. `04_사진목록.txt`
5. `05_업로드안내.txt`

파일은 선택 미디어와 같은 촬영 세션의 `광고묶음/vNN` 폴더에 저장한다. RTDB `adPackages`에는 Drive 폴더·파일 ID, 동결된 매물 정보, 선택 미디어 ID와 생성자/시간을 기록한다.

## UX와 오류 복구

- 상단에 `Drive 연결됨/연결 필요` 상태와 회사 계정을 표시한다.
- 연결 전 촬영은 기기 IndexedDB에 안전하게 대기시키고, 연결 후 자동 재개한다.
- 업로드 진행률, 실패 이유, 다시 시도, Drive에서 열기를 제공한다.
- 토큰 만료 시 사용자 동작에서 조용히 재승인하고, 로그인 취소 시 원본 큐는 보존한다.
- 앱을 닫아도 미완료 파일은 기기에 남고 다음 실행에서 재개한다.
- 서비스 워커는 새 배포를 즉시 활성화하며 API/OAuth 응답은 캐시하지 않는다.

## 검증 기준

- Android Chrome에서 회사 계정 로그인과 Drive 권한 승인 성공
- 사진과 8MiB 이상 영상이 지정 폴더에 업로드됨
- 같은 업로드 재시도 시 Drive 파일이 중복되지 않음
- 비행기 모드 후 온라인 복귀 시 큐 재개
- 광고 TXT 5개가 올바른 폴더와 내용으로 생성됨
- 새로고침 후 RTDB와 Drive 상태가 동일하게 표시됨
- 권한 없는 계정과 다른 사용자의 세션/미디어 쓰기가 규칙에서 거부됨

