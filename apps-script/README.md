# BRING Care 민원접수 자동 분석 설치

이 폴더의 `complaint-intake-to-firebase.gs`는 Google Form 응답 시트에서 새 민원이 들어올 때 자동으로 분석하고, FM GitHub.io 앱의 Firebase `/cases` 경로에 케이스를 등록하는 Apps Script 코드입니다.

## 설치 순서

1. Google Sheets 응답 시트를 엽니다.
   - https://docs.google.com/spreadsheets/d/1HI6KzIMomL6vOUPs8zZDhXHktL1cWRDcg93lflsuojA/edit
2. 상단 메뉴에서 `확장 프로그램` -> `Apps Script`를 엽니다.
3. 기본 코드 내용을 지우고 `complaint-intake-to-firebase.gs` 내용을 붙여넣습니다.
4. 저장 후 함수 선택 드롭다운에서 `setupComplaintAutomation`을 선택합니다.
5. `실행`을 누르고 Google 권한 승인을 완료합니다.

## 작동 방식

- 새 응답이 들어오면 `onComplaintFormSubmit` 트리거가 실행됩니다.
- 응답 시트에 아래 자동 분석 컬럼을 추가하거나 갱신합니다.
  - 접수번호
  - 긴급도
  - 민원 요약
  - 업체 분류
  - 상태값
  - Firebase Case ID
  - 분석 처리일시
- Firebase Realtime Database의 `/cases/{접수번호}`에 케이스를 등록합니다.
- GitHub.io FM 앱의 `케이스` 화면에서 자동 등록된 민원을 볼 수 있습니다.

## 개인정보 주의

현재 FM 앱은 로그인 없이 링크 접근이 가능한 구조입니다. 그래서 Apps Script는 이름, 연락처, 호실을 마스킹해서 Firebase에 보냅니다. 원본 개인정보와 사진 링크는 Google Sheets 응답 시트에서 확인하는 구조로 두었습니다.

## 테스트

설치 후 세입자용 폼으로 테스트 민원 1건을 제출하세요.

- 폼: https://docs.google.com/forms/d/e/1FAIpQLSfzi-H-abXT-dgsU5rF8vgkWuKtbltr9acgWClVeQ5W297DiA/viewform
- 앱: https://bringengineering.github.io/FM/

테스트 응답이 들어오면 시트에 분석 컬럼이 채워지고, 앱의 `케이스` 화면에 새 접수번호가 표시됩니다.
