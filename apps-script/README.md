# BRING Care 민원접수 자동 분석 설치

이 폴더의 `complaint-intake-to-firebase.gs`는 Google Form 응답 시트에서 새 민원이 들어올 때 자동으로 분석하고, FM GitHub.io 앱의 Firebase `/cases` 경로에 케이스를 등록하는 Apps Script 코드입니다.

## 설치 순서

1. Google Sheets 응답 시트를 엽니다.
   - https://docs.google.com/spreadsheets/d/1HI6KzIMomL6vOUPs8zZDhXHktL1cWRDcg93lflsuojA/edit
2. 상단 메뉴에서 `확장 프로그램` -> `Apps Script`를 엽니다.
3. 기본 코드 내용을 지우고 `complaint-intake-to-firebase.gs` 내용을 붙여넣습니다.
4. 온보딩 수집서 DOCX 파일이 들어 있는 Google Drive 폴더를 연결하려면 코드 상단의 `CONTRACT_DRIVE_FOLDER_ID`에 폴더 ID 또는 폴더 URL을 넣습니다.
   - 현재 설정값은 `1818MusPDfVV6znALkWDMGK99NXAlAj8g`입니다.
   - ⑥ 견적 파일을 별도 폴더에 저장하려면 `QUOTE_DRIVE_FOLDER_ID`에 폴더 ID를 넣습니다. 비워두면 기존 Drive 폴더 아래 `견적서 회신` 폴더를 자동으로 만듭니다.
   - ⑥ 브링 양식 견적서 자동 생성을 쓰려면 `브링엔지니어링_견적서_양식.xlsx`를 Google Drive에 올린 뒤 Google Sheets로 열어 변환하고, 그 Google Sheet 파일 ID를 `QUOTE_TEMPLATE_SPREADSHEET_ID`에 넣습니다.
5. 왼쪽 톱니바퀴 `프로젝트 설정`에서 `appsscript.json 매니페스트 파일 표시`를 켭니다.
6. 왼쪽 파일 목록의 `appsscript.json`에 이 폴더의 `appsscript.json` 내용을 붙여넣습니다.
7. 저장 후 함수 선택 드롭다운에서 `setupComplaintAutomation`을 선택해 실행합니다.
8. 네이버클라우드 SENS 문자 발송을 쓰려면 `프로젝트 설정` -> `스크립트 속성`에 아래 값을 추가합니다.
   - `NCP_SENS_SERVICE_ID`: SENS SMS 서비스 ID
   - `NCP_ACCESS_KEY`: 네이버클라우드 Access Key ID
   - `NCP_SECRET_KEY`: 네이버클라우드 Secret Key
   - `NCP_SENS_FROM`: SENS에 등록/승인된 발신번호
   - `NCP_SENS_TEST_TO`: 테스트 문자를 받을 내 번호
   - `SMS_ENABLED`: `true`
9. ⑤ 업체 MMS 발송을 쓰려면 Apps Script에서 `배포` -> `새 배포` -> `웹 앱`으로 배포합니다.
   - 실행 사용자: `나`
   - 액세스 권한: GitHub.io 화면에서 호출할 수 있는 권한으로 설정
   - 배포 후 생성된 웹 앱 URL을 FM 앱 ⑤ `업체 발송` 버튼의 `MMS 웹앱 설정`에 붙여넣습니다.
10. Google 권한 승인을 완료합니다.

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
  - 문자 발송 상태
  - 문자 발송 메모
  - Firebase Case ID
  - 분석 처리일시
- `setupComplaintAutomation` 실행 시 Google Form에 `건물 주소` 필수 질문을 추가합니다.
- 민원 접수 시 `건물명`으로 Drive 폴더 안의 DOCX 본문을 검색합니다.
- 건물명 후보가 1건이면 케이스 ①의 `온보딩 수집서` 버튼이 해당 Drive 파일을 엽니다.
- 건물명 후보가 여러 개면 `건물 주소`를 추가로 본문 검색해서 1건으로 좁힙니다.
- 매칭이 없거나 복수 후보가 남으면 케이스는 생성하되 `계약확인보류` 상태로 표시됩니다.
- 파일명 검색이나 인덱스 시트 fallback은 사용하지 않습니다. DOCX 본문 안에 건물명, 가능하면 주소도 들어 있어야 합니다.
- NCP SENS 설정이 완료되어 있으면 세입자 연락처와 온보딩 수집서의 건물주 연락처로 접수 확인 문자를 발송합니다.
- 온보딩 수집서 DOCX 본문에 `건물주 연락처: 010-0000-0000` 형식의 항목을 넣으면 건물주 번호를 자동 추출합니다.
- ④에서 선택한 업체가 있으면 ⑤에서 구글폼 첨부 사진의 첫 번째 JPG/JPEG를 SENS MMS로 보내는 견적 요청을 실행할 수 있습니다.
- MMS 첨부는 SENS 제한 때문에 JPG/JPEG만 사용하며, 300KB를 넘으면 발송하지 않고 ⑤를 진행중/보류로 둡니다.
- ⑥ 견적 비교에서 업체별 회신 견적 파일을 업로드하면 원본은 `원본 견적서` 폴더에 저장되고, `QUOTE_TEMPLATE_SPREADSHEET_ID`가 설정되어 있으면 브링 양식 Google Sheet와 XLSX 파일을 `브링 양식 견적서` 폴더에 생성합니다.
- XLSX/DOCX는 본문 텍스트를 직접 추출하고, PDF/JPG/PNG는 고급 Google 서비스 `Drive API(v3)` OCR을 사용합니다. OCR이 꺼져 있거나 실패하면 원본은 저장하고 케이스에 `확인필요/추출실패`로 표시합니다.
- Realtime Database의 `/cases/{접수번호}`에 케이스를 등록합니다.
- GitHub.io FM 앱의 `케이스` 화면에서 자동 등록된 민원을 볼 수 있습니다.

## 개인정보 주의

FM 앱의 `케이스` 화면은 현재 별도 인증 없이 열립니다. 그래서 Apps Script는 세입자 이름, 연락처, 호실을 마스킹해서 Firebase에 보내고, 원본 개인정보와 사진 링크, Drive 온보딩 원본 파일은 Google Sheets/Drive 권한이 있는 계정에서 확인하는 구조를 유지합니다.

## 테스트

설치 후 세입자용 폼으로 테스트 민원 1건을 제출하세요.

- 폼: https://docs.google.com/forms/d/e/1FAIpQLSfzi-H-abXT-dgsU5rF8vgkWuKtbltr9acgWClVeQ5W297DiA/viewform
- 앱: https://bringengineering.github.io/FM/

테스트 응답이 들어오면 시트에 분석 컬럼이 채워지고, 앱의 `케이스` 화면에 새 접수번호가 표시됩니다.

온보딩 파일 매칭까지 테스트하려면 Drive 폴더에 DOCX 파일을 올리고, 본문에 테스트 건물의 `건물명`을 넣은 뒤 같은 건물명으로 폼을 제출하세요. 같은 건물명이 들어간 DOCX가 여러 개라면 본문에 `건물 주소`까지 넣어 주소로 1건만 남는지 확인하세요.

## Drive 권한 오류가 뜰 때

`You do not have permission to call DriveApp.searchFiles`가 보이면 Apps Script 프로젝트에 Drive 읽기 권한이 아직 붙지 않은 상태입니다.

1. `appsscript.json`에 `https://www.googleapis.com/auth/drive`가 들어 있는지 확인합니다.
2. 저장 후 `setupComplaintAutomation`을 다시 실행합니다.
3. 권한 승인 창이 뜨면 승인합니다.
4. 그래도 안 뜨면 함수 선택에서 `authorizeDriveAccess`를 실행해 Drive 권한만 따로 승인합니다.

## 네이버클라우드 SENS 문자 테스트

1. 네이버클라우드 콘솔에서 SENS SMS 프로젝트를 만들고 발신번호를 등록/승인합니다.
2. Apps Script `프로젝트 설정` -> `스크립트 속성`에 `NCP_SENS_SERVICE_ID`, `NCP_ACCESS_KEY`, `NCP_SECRET_KEY`, `NCP_SENS_FROM`, `NCP_SENS_TEST_TO`를 넣습니다.
3. `appsscript.json`에 `script.external_request`, `script.storage` 권한이 들어 있는지 확인합니다.
4. 함수 선택에서 `testSensSmsSetup`을 실행합니다.
5. 테스트 문자가 오면 `setupComplaintAutomation`을 실행해 실제 구글폼 접수 자동 문자 발송을 켭니다.

NCP Secret Key는 GitHub나 HTML 화면에 절대 넣지 않습니다. Apps Script의 스크립트 속성에만 저장합니다.

## ⑥ 견적 파일 업로드 테스트

1. ⑤가 완료되어 ⑥이 `진행중`인지 확인합니다.
2. ⑥ 메모 버튼을 열고 견적 파일만 선택합니다.
3. 파일은 PDF, JPG/JPEG, PNG, DOC/DOCX, XLS/XLSX만 가능하며 최대 5MB입니다.
4. 업체가 1곳만 선택되어 있으면 자동으로 그 업체에 연결됩니다. 여러 곳이면 파일 본문에서 업체명을 추출하고, 애매하면 `업체 확인 필요`로 남깁니다.
5. 처음 사용할 때는 `caseAutomationEndpoint`에 Apps Script 웹 앱 URL을 저장합니다. ⑤ MMS 웹앱 URL과 같은 URL을 사용해도 됩니다.
6. 업로드 후 케이스 ⑥ 카드에 `원본 열기`, `브링 양식`, `XLSX 다운로드` 링크와 추출 상태가 표시되는지 확인합니다.
7. PDF/JPG/PNG 추출을 테스트하려면 Apps Script 왼쪽 `서비스`에서 `Drive API`가 추가되어 있는지 확인합니다. 매니페스트에는 `Drive API v3` 설정이 포함되어 있습니다.

## ⑤ 업체 MMS 견적 요청 테스트

1. 구글폼 테스트 민원에 JPG/JPEG 사진을 첨부합니다.
2. FM 앱 케이스에서 ④ 메모를 열고 업체 후보 중 발송할 업체를 선택합니다.
3. ⑤ `업체 발송`을 누른 뒤 `MMS 웹앱 설정`에 Apps Script 웹 앱 URL을 저장합니다.
4. `MMS 발송 요청`을 누릅니다.
5. 발송 결과는 케이스 ⑤ 메모와 기록에 자동 반영됩니다.

발신번호가 승인 대기 중이면 SENS API가 실패 응답을 줄 수 있습니다. 이 경우 케이스 ⑤는 완료되지 않고 `진행중/보류`로 남습니다.
