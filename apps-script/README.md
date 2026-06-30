# BRING Care 민원접수 자동 분석 설치

이 폴더의 `complaint-intake-to-firebase.gs`는 Google Form 응답 시트에서 새 민원이 들어올 때 자동으로 분석하고, FM GitHub.io 앱의 Firebase `/cases` 경로에 케이스를 등록하는 Apps Script 코드입니다.

## 설치 순서

1. Google Sheets 응답 시트를 엽니다.
   - https://docs.google.com/spreadsheets/d/1HI6KzIMomL6vOUPs8zZDhXHktL1cWRDcg93lflsuojA/edit
2. 상단 메뉴에서 `확장 프로그램` -> `Apps Script`를 엽니다.
3. 기본 코드 내용을 지우고 `complaint-intake-to-firebase.gs` 내용을 붙여넣습니다.
4. 온보딩 수집서 DOCX 파일이 들어 있는 Google Drive 폴더를 연결하려면 코드 상단의 `CONTRACT_DRIVE_FOLDER_ID`에 폴더 ID 또는 폴더 URL을 넣습니다.
   - 현재 설정값은 `1818MusPDfVV6znALkWDMGK99NXAlAj8g`입니다.
5. 저장 후 함수 선택 드롭다운에서 `setupComplaintAutomation`을 선택합니다.
6. `실행`을 누르고 Google 권한 승인을 완료합니다.

## 작동 방식

- 새 응답이 들어오면 `onComplaintFormSubmit` 트리거가 실행됩니다.
- 응답 시트에 아래 자동 분석 컬럼을 추가하거나 갱신합니다.
  - 접수번호
  - 긴급도
  - 민원 요약
  - 업체 분류
  - 상태값
  - 온보딩 매칭 상태
  - 온보딩 파일명
  - 온보딩 확인 메모
  - Firebase Case ID
  - 분석 처리일시
- `setupComplaintAutomation` 실행 시 Google Form에 `건물 주소` 필수 질문을 추가합니다.
- 민원 접수 시 `건물명`으로 Drive 폴더 안의 DOCX 본문을 검색합니다.
- 건물명 후보가 1건이면 케이스 ①의 `온보딩 수집서` 버튼이 해당 Drive 파일을 엽니다.
- 건물명 후보가 여러 개면 `건물 주소`를 추가로 본문 검색해서 1건으로 좁힙니다.
- 매칭이 없거나 복수 후보가 남으면 케이스는 생성하되 `계약확인보류` 상태로 표시됩니다.
- 파일명 검색이나 인덱스 시트 fallback은 사용하지 않습니다. DOCX 본문 안에 건물명, 가능하면 주소도 들어 있어야 합니다.
- Firebase Realtime Database의 `/cases/{접수번호}`에 케이스를 등록합니다.
- GitHub.io FM 앱의 `케이스` 화면에서 자동 등록된 민원을 볼 수 있습니다.

## 개인정보 주의

현재 FM 앱은 로그인 없이 링크 접근이 가능한 구조입니다. 그래서 Apps Script는 세입자 이름, 연락처, 호실을 마스킹해서 Firebase에 보냅니다. 원본 개인정보와 사진 링크, Drive 온보딩 원본 파일은 Google Sheets/Drive 권한이 있는 계정에서 확인하는 구조로 두었습니다.

## 테스트

설치 후 세입자용 폼으로 테스트 민원 1건을 제출하세요.

- 폼: https://docs.google.com/forms/d/e/1FAIpQLSfzi-H-abXT-dgsU5rF8vgkWuKtbltr9acgWClVeQ5W297DiA/viewform
- 앱: https://bringengineering.github.io/FM/

테스트 응답이 들어오면 시트에 분석 컬럼이 채워지고, 앱의 `케이스` 화면에 새 접수번호가 표시됩니다.

온보딩 파일 매칭까지 테스트하려면 Drive 폴더에 DOCX 파일을 올리고, 본문에 테스트 건물의 `건물명`을 넣은 뒤 같은 건물명으로 폼을 제출하세요. 같은 건물명이 들어간 DOCX가 여러 개라면 본문에 `건물 주소`까지 넣어 주소로 1건만 남는지 확인하세요.
