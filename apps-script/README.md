# BRING Care 민원접수 자동 분석 설치

카카오 알림톡을 켜면 ② 세입자·건물주 접수 안내와 ⑧ 건물주 추천 견적 안내를 `@bringcare` 채널로 먼저 발송합니다. 알림톡 요청이 거절되면 기존 SENS SMS로 즉시 대체하고, 알림톡을 끈 상태에서는 기존 SMS/MMS 흐름을 그대로 유지합니다. 건물주 추천 알림은 발송 직전 체크포인트를 저장하고, SENS 접수 성공 후 발송 결과와 ⑧ 완료·⑨ 진행중 상태를 하나의 Firebase 업데이트로 반영합니다. 성공 결과는 `automationState.ownerRecommendationMms`에도 별도로 보존해 오래 열린 화면이 상태를 되돌려도 자동 복구하며, 일시적인 저장 오류는 최대 3회 재시도합니다.

카카오 챗봇 민원 접수를 켜면 `브링케어` 채널 대화 안에서 건물명, 주소, 호실, 세입자명, 연락처, 문제 유형, 증상, 방문 가능 시간을 순서대로 입력받습니다. 원본 카카오 사용자 키는 저장하지 않고 SHA-256 해시만 Firebase 케이스와 연결합니다. 접수 즉시 접수번호와 `접수처리중` 케이스를 만든 뒤 1분 대기열이 기존 구글폼 분석·계약 매칭·접수 안내 흐름을 실행합니다.

현재 자동 진행 기준은 다음과 같습니다. 새 민원이 온보딩 수집서와 매칭되면 ①을 완료하고 ② 접수확인 문자를 자동 발송합니다. 세입자·건물주 발송이 모두 성공하면 ③ 상담카드와 ④ 업체 분류를 자동 완료한 뒤 ⑤에서 멈춥니다. 관리자가 ⑤에서 업체를 선택해 견적 요청 MMS를 보내고 전체 발송이 성공하면 ⑥이 열립니다. ⑥에서 현재 선택한 파일의 업로드가 모두 끝나고 금액이 확인된 견적이 한 건 이상이면 ⑦ 최저가 추천을 자동 완료하고, ⑧ 건물주 추천 MMS를 자동 발송합니다. 발송이 성공하면 ⑨ 승인·입금이 진행중으로 열립니다.

이 폴더의 `complaint-intake-to-firebase.gs`는 Google Form 응답 시트에서 새 민원이 들어올 때 자동으로 분석하고, FM GitHub.io 앱의 Firebase `/cases` 경로에 케이스를 등록하는 Apps Script 코드입니다.

현재 연결된 Realtime Database는 `BRING-FM-HJ` 프로젝트의 `https://bring-fm-hj-default-rtdb.asia-southeast1.firebasedatabase.app`입니다.

## 설치 순서

1. Google Sheets 응답 시트를 엽니다.
   - https://docs.google.com/spreadsheets/d/1HI6KzIMomL6vOUPs8zZDhXHktL1cWRDcg93lflsuojA/edit
2. 상단 메뉴에서 `확장 프로그램` -> `Apps Script`를 엽니다.
3. 기본 코드 내용을 지우고 `complaint-intake-to-firebase.gs` 내용을 붙여넣습니다.
4. 온보딩 수집서 DOCX 파일이 들어 있는 Google Drive 폴더를 연결하려면 코드 상단의 `CONTRACT_DRIVE_FOLDER_ID`에 폴더 ID 또는 폴더 URL을 넣습니다.
   - 현재 설정값은 `1GKI8oc4iicdEw7MnPKpfZrwKd4ZGKnBZ`입니다.
   - ⑥ 견적 파일은 `QUOTE_DRIVE_FOLDER_ID`에 지정한 견적서 전용 폴더에 저장합니다. 현재 설정값은 `11QX5F-KRQvvYNc0hso3QACuMS7lMZw4r`입니다.
   - ⑥ 사업자등록증은 견적서 저장 폴더 안의 케이스 폴더에 원본 파일로 바로 저장합니다. 구조는 `{접수번호}_{건물명} / 사업자등록증 / BR-..._{업체명}_사업자등록증.pdf`입니다.
   - ⑥ 브링 양식 견적서 자동 생성을 쓰려면 `브링엔지니어링_견적서_양식.xlsx`를 Google Drive에 올린 뒤 Google Sheets로 열어 변환하고, 그 Google Sheet 파일 ID를 `QUOTE_TEMPLATE_SPREADSHEET_ID`에 넣습니다.
   - 업로드 속도를 위해 MinerU 실시간 분석은 기본적으로 기다리지 않습니다. 업로드 중 MinerU까지 기다리려면 Apps Script `프로젝트 설정` -> `스크립트 속성`에 `MINERU_SYNC_ENABLED`를 `true`로 넣고, `MINERU_API_KEY`를 함께 넣습니다.
5. 왼쪽 톱니바퀴 `프로젝트 설정`에서 `appsscript.json 매니페스트 파일 표시`를 켭니다.
6. 왼쪽 파일 목록의 `appsscript.json`에 이 폴더의 `appsscript.json` 내용을 붙여넣습니다.
7. 저장 후 함수 선택 드롭다운에서 `setupComplaintAutomation`을 선택해 실행합니다.
   - 이때 온보딩 DOCX의 건물명·주소도 `caseSettings/paymentBuildings`로 동기화되어 입금확인 캘린더의 건물 목록으로 사용됩니다.
   - 건물 목록만 다시 읽고 싶으면 `syncPaymentBuildings`를 실행하거나 FM 화면의 `온보딩 건물 새로고침`을 누릅니다.
8. 네이버클라우드 SENS 문자 발송을 쓰려면 `프로젝트 설정` -> `스크립트 속성`에 아래 값을 추가합니다.
   - `NCP_SENS_SERVICE_ID`: SENS SMS 서비스 ID
   - `NCP_ACCESS_KEY`: 네이버클라우드 Access Key ID
   - `NCP_SECRET_KEY`: 네이버클라우드 Secret Key
   - `NCP_SENS_FROM`: SENS에 등록/승인된 발신번호
   - `NCP_SENS_TEST_TO`: 테스트 문자를 받을 내 번호
   - `SMS_ENABLED`: `true`
   - `VENDOR_QUOTE_REPLY_EMAIL`: 업체 견적서를 회신받을 이메일 주소 (기본값: `bringengineering1008@gmail.com`)
   - 카카오 알림톡은 템플릿 승인 후 아래 값을 추가합니다. 승인 전에는 `KAKAO_ALIMTALK_ENABLED=false`를 유지합니다.
   - `KAKAO_ALIMTALK_ENABLED`: `true`
   - `NCP_BIZ_MESSAGE_SERVICE_ID`: `ncp:kkobizmsg:kr:373088811226:bring_care_kakao`
   - `KAKAO_CHANNEL_ID`: `@bringcare`
   - `KAKAO_TEMPLATE_RECEIPT_TENANT`: `BRINGRECEIPTTENANTV1`
   - `KAKAO_TEMPLATE_RECEIPT_OWNER`: `BRINGRECEIPTOWNERV1`
   - `KAKAO_TEMPLATE_OWNER_QUOTE`: `BRINGOWNERQUOTEV1`
   - `KAKAO_TEMPLATE_PAYMENT_REMINDER`: `BRINGRENTREMINDERV1`
   - `KAKAO_SMS_FAILOVER_ENABLED`: NCP 채널의 SMS 대체 발송 설정까지 완료한 뒤 `true`, 그전에는 `false`
   - 카카오 챗봇 민원 접수는 `setupKakaoComplaintIntake`를 한 번 실행해 스킬 토큰과 1분 대기열 트리거를 만든 뒤 설정합니다.
   - `KAKAO_CHATBOT_INTAKE_ENABLED`: 챗봇 연결 전 `false`, 봇 테스트 완료 후 `true`
   - `KAKAO_CHATBOT_SKILL_TOKEN`: `setupKakaoComplaintIntake`가 자동 생성하므로 GitHub에 기록하지 않음
   - `KAKAO_CHATBOT_BOT_ID`: 챗봇 관리자센터의 봇 ID. 다른 봇 요청 차단용이며 운영 연결 전에 설정
   - `KAKAO_CHATBOT_PHOTO_BLOCK_ID`: `@sys.plugin.secureimage` 필수 파라미터를 연결한 `현장 사진 등록` 블록 ID
9. ② 접수확인 문자, ⑤ 업체 MMS, ⑥ 파일 업로드, ⑧ 건물주 추천 MMS 자동화를 쓰려면 Apps Script에서 `배포` -> `새 배포` -> `웹 앱`으로 배포합니다.
   - 입금확인 캘린더의 건물 새로고침도 이 웹 앱의 `syncPaymentBuildings` 요청을 사용합니다.
   - 실행 사용자: `나`
   - 액세스 권한: GitHub.io 화면에서 호출할 수 있는 권한으로 설정
   - 배포 후 생성된 웹 앱 URL을 FM 앱 ② `SENS 문자`, ⑤ `업체 발송`, ⑥ 업로드, ⑧ `건물주 추천 MMS`에서 사용하는 자동화 웹앱 URL에 연결합니다.
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
- 카카오 챗봇 접수는 동일한 응답 시트에 `접수 경로=kakao_chatbot`으로 추가되고, 1분 트리거가 기존 `processResponseRow_` 처리를 재사용합니다. Firebase 케이스의 `source`와 `kakao.userKeyHash`로 카카오 계정과 접수번호를 연결하며 `내 민원 조회` 발화로 최근 케이스 상태를 확인할 수 있습니다.
- 민원 접수 시 Drive 폴더의 DOCX 본문을 읽고 `건물명+주소 정확 일치` → `정규화 건물명 일치` → `건물명 60%+주소 40% 유사도` 순서로 온보딩 수집서를 선택합니다.
- 유사 후보 점수가 같으면 주소 유사도가 높은 파일, 그다음 Drive 수정일이 최신인 파일을 선택합니다.
- 후보가 전혀 없을 때만 케이스를 `계약확인보류` 상태로 유지합니다.
- 파일명 검색이나 인덱스 시트 fallback은 사용하지 않습니다. DOCX 본문 안에 건물명, 가능하면 주소도 들어 있어야 합니다.
- 카카오 알림톡 설정과 승인 템플릿이 준비되어 있으면 새 구글폼 접수 시 세입자와 건물주에게 `@bringcare` 접수 알림톡을 발송합니다. 알림톡 API 요청이 실패하면 기존 SENS SMS로 즉시 대체합니다.
- 운영 모드에서는 ② 접수확인 알림이 자동 발송되며, 결과와 실제 발송 공급자(`kakao_alimtalk`, `sens_sms_fallback`, `sens_sms`)는 케이스 ② 메모·자동화 상태와 응답 시트의 문자 발송 상태/메모에 반영됩니다. 실패한 케이스는 ② 진행중 상태와 실패 사유를 유지합니다.
- 온보딩 수집서 DOCX 본문에 `건물주 연락처: 010-0000-0000` 형식의 항목을 넣으면 건물주 번호를 자동 추출합니다.
- ⑤에서 선택한 업체가 있으면 구글폼 첨부 사진의 첫 번째 JPG/JPEG를 SENS MMS로 보내는 견적 요청을 실행할 수 있습니다.
- MMS 첨부는 SENS 제한 때문에 JPG/JPEG를 사용하며, 300KB를 넘는 사진은 Apps Script가 자동 축소한 뒤 발송합니다. 자동 축소가 실패하면 ⑤를 진행중/보류로 둡니다.
- ⑤ 업체 MMS는 휴대폰 번호만 발송 대상으로 봅니다. 업체리스트에 일반전화/0507 번호만 있으면 해당 업체는 제외되고 ⑤ 메모에 사유가 표시됩니다.
- SENS가 발송 요청을 접수하면 ⑤ 메모에 업체별 `요청ID`가 표시됩니다. 실제 단말 도착 여부는 Naver Cloud SENS 콘솔의 메시지 발송 내역에서 이 요청ID로 확인합니다.
- ⑤에서 선택한 업체 전체에 MMS 발송이 성공해야 ⑤가 완료되고 ⑥ 견적 비교가 진행중으로 열립니다. 일부 실패, 번호 없음, 사진 누락은 ⑤ 진행중/보류로 남기고 사유를 메모에 표시합니다.
- ⑥ 업로드 묶음 처리가 끝나고 금액이 확인된 견적이 한 건 이상이면 원본 견적금액이 가장 낮은 업체를 ⑦ 최적 추천으로 자동 확정합니다.
- ⑦ 추천 정보가 준비되면 ⑧에서 온보딩 수집서의 건물주 번호로 추천 알림을 자동 발송합니다. 카카오 알림톡이 켜져 있으면 추천 업체·금액과 `추천 견적 확인` 버튼을 발송하고, 버튼은 기존 모바일 승인 화면으로 연결됩니다. 알림톡이 꺼져 있으면 기존 추천 이미지 MMS를 발송합니다.
- ⑧ 발송용 추천 견적 이미지는 케이스 폴더의 `건물주 추천 발송` 하위에 세로형 JPG로 저장합니다. `owner-summary-v4` 디자인은 Google Sheet 카드와 PDF를 거쳐 렌더링해 한글 글꼴 깨짐을 방지하고, 최종 합계금액을 가장 크게 표시하며 추천 업체, 한국시간 방문 가능 시간, 작업 품목 최대 4개, 공급가액, 부가세만 남깁니다. 시간 전용 응답의 1899년 날짜는 실제 방문일 또는 접수일과 결합합니다. 구버전 이미지는 새 발송에서 재사용하지 않으며, SENS 전송 직전에는 최대 800px·300KB 이하 JPEG로 축소합니다. SENS가 MMS 발송 요청을 정상 접수하면 ⑧은 완료되고 ⑨ 승인·입금은 진행중으로 자동 전환합니다. 연락처 없음, 이미지 생성 실패, SENS 오류는 ⑧ 진행중/보류로 남깁니다.
- ⑧에 진입하면 케이스별 모바일 승인 링크를 먼저 생성하고, Apps Script가 실제 승인 화면을 열어 유효성을 확인한 뒤에만 건물주 추천 MMS를 발송합니다. 링크 확인에 실패하면 MMS를 보내지 않고 ⑧ 진행중에 유지합니다. 건물주가 `승인하고 입금 진행`을 선택하면 ⑨ 완료·⑩ 입금 확인 진행중으로 자동 전환됩니다. 건물주가 별도로 입금을 신고하는 버튼은 두지 않으며, 관리자가 실제 고정 사업자계좌 입금 내역을 확인한 뒤 대시보드 ⑩의 `입금 확인`을 누릅니다. 확인이 저장되면 ⑩ 완료·⑪ 업체 연결 및 일정 진행중으로 전환됩니다. `다른 견적 요청`을 선택하면 현재 견적 회차를 이력으로 보관하고 ⑤ 업체 견적 요청부터 새 회차를 시작합니다.

## 팝빌 계좌조회 테스트 연결

Apps Script `프로젝트 설정 > 스크립트 속성`에 아래 값을 저장합니다. 비밀키는 코드나 GitHub에 커밋하지 않습니다.

- `POPBILL_IS_TEST`: 테스트환경은 `true`
- `POPBILL_LINK_ID`: 팝빌에서 발급한 LinkID
- `POPBILL_SECRET_KEY`: 팝빌에서 발급한 SecretKey
- `POPBILL_CORP_NUM`: 하이픈을 제외한 팝빌 회원 사업자번호
- `POPBILL_USER_ID`: 팝빌 테스트 회원 ID

`verifyPopbillEasyFinBankConnection()`은 계좌조회 권한과 등록 계좌 목록을 확인하며, 로그에는 계좌번호 뒤 4자리만 남깁니다.
연동 파트너 계정에서 직접 등록 버튼이 보이지 않으면 `getPopbillBankAccountManagerUrl()`을 실행하고 로그에 출력되는 30초 유효 팝빌 테스트 URL을 바로 엽니다. 계좌번호·계좌 비밀번호·실명번호·신한은행 조회전용 ID/PW는 이 팝빌 화면에만 입력합니다.
`testPopbillBankTransactionCollection()`은 최근 30일 입금 거래를 실제로 수집할 수 있는지 계좌별 건수만 확인합니다. 입금자명과 전체 계좌번호는 실행 로그에 남기지 않습니다.
FM 입금확인 캘린더를 열면 `syncPopbillBankTransactions`가 로그인 사용자의 Firebase ID 토큰으로 전용 경로에 거래를 저장합니다. 화면이 열려 있는 동안 30분 간격으로 다시 조회합니다. 온보딩 건물 카드에서 팝빌 등록계좌를 연결하면 서버가 만든 HMAC 기반 익명 계좌 ID와 은행·끝 4자리만 `bankBindings`에 저장되고, 해당 계좌에 연결된 건물 일정만 입금자명·금액·납부기간으로 비교합니다. 정확히 일치하는 유일한 거래는 `입금완료`, 중복 후보는 `확인필요`로 표시합니다. Firebase에는 입금일·입금자명·금액·계좌번호 끝 4자리만 저장하며 전체 계좌번호, 계좌 비밀번호, 조회전용 ID/PW, Popbill SecretKey는 저장하지 않습니다.
- ⑥ 견적 비교에서 업체별 회신 견적 파일을 업로드하면 `QUOTE_DRIVE_FOLDER_ID` 폴더 아래 `{접수번호}_{건물명}` 케이스 폴더를 만들고, 원본은 `원본 견적서` 폴더에 저장합니다. `QUOTE_TEMPLATE_SPREADSHEET_ID`가 설정되어 있으면 브링 양식 엑셀 파일을 `브링 양식 견적서` 폴더에 `{업체명}_{yyyyMMdd}.xlsx` 이름으로 생성합니다.
- ⑥ 사업자등록증은 견적서 저장 폴더의 케이스 폴더 안에 `사업자등록증 / BR-..._{업체명}_사업자등록증.pdf` 구조로 원본만 바로 저장합니다. 예: `{접수번호}_{건물명} / 사업자등록증 / BR-2026-0002_업체명_사업자등록증.pdf`. 업체명을 못 찾으면 파일명에 `업체확인필요`를 사용합니다.
- 사업자등록증 업로드 후 분석값이 같은 업체 견적 카드와 매칭되면, 기존 브링 엑셀 견적서의 빈칸을 자동으로 보충해 최신 엑셀 링크로 교체합니다. 사업자등록증은 ⑥ 견적 카드 목록에는 표시하지 않고, 원본 견적서와 사업자등록증 원본은 삭제하지 않습니다.
- 업체명, 전화번호, 사업자번호, 대표자, 주소, 업태, 업종, 이메일은 견적서 본문 추출값을 우선 사용하고, 빈칸만 같은 업체 사업자등록증 -> ④ 업체리스트_현진 순서로 보충합니다. `테스트`, `샘플`, `업체 확인 필요` 같은 임시 문구는 업체명으로 사용하지 않습니다.
- 사업자등록증은 표/라벨 형태를 우선 분석합니다. `업태 건설업 / 종목 전기공사업`처럼 같은 줄에 있는 값도 분리하고, 주소는 다음 라벨이 나오기 전까지만 가져와 브링 엑셀 `D6/I7/D8/D9/I9/D10/I10` 빈칸 보충에 사용합니다.
- 사업자등록증은 업로드만 하면 자동으로 브링 엑셀 빈칸 보충에 사용됩니다. 기존 브링 엑셀도 같은 업체 사업자등록증이 매칭되면 최신 엑셀 파일 링크로 자동 교체됩니다.
- 사업자등록증 기본 분석과 업체리스트 매칭 후에도 사업자번호/대표자/주소/업태/업종/전화/이메일 중 빈칸이 남으면, `MINERU_API_KEY`가 있을 때만 MinerU OCR을 보조로 호출해 빈칸만 채웁니다. 이미 채워진 값은 MinerU 결과로 덮어쓰지 않습니다.
- 업체 견적 파일 업로드 직후 생성되는 브링 양식은 `초안`으로 표시됩니다. 자동 추출 금액이 틀리면 FM 앱 ⑥ 견적 카드의 `합계금액 확인/수정`에 부가세 포함 합계금액을 입력하고 `브링 양식 재작성`을 누르세요. 확정 합계금액이 카드, 비교 메모, 브링 양식에 우선 반영되고 상태가 `확정`으로 바뀝니다.
- 브링 양식 생성 직후에는 템플릿의 고정 셀 `D15 -> J30 -> E30+H30` 순서로 합계금액을 다시 읽어 견적 카드에 `브링 양식 기준` 금액으로 표시합니다.
- 빠른 업로드를 위해 기본값은 MinerU 실시간 분석을 생략하고 기존 Apps Script 추출 방식으로 처리합니다. `MINERU_SYNC_ENABLED=true`와 `MINERU_API_KEY`가 설정되어 있으면 견적 업로드 중 mineru.net 정밀 API를 기다려 분석값을 사용합니다. 분석 결과 Markdown/JSON 파일은 Drive에 따로 저장하지 않고, 견적 카드에는 원본 파일과 최종 엑셀 견적서 링크만 표시합니다.
- 단, 사업자등록증은 브링 엑셀 공급자 빈칸이 남는 경우에만 예외적으로 MinerU OCR을 보조 호출합니다. 토큰이 없거나 MinerU가 실패하면 기존 추출값만 유지하고 빈칸은 빈칸으로 둡니다.
- 별도 MinerU 중계 서버를 쓰고 싶으면 `MINERU_API_URL`에 서버 주소를 넣습니다. 이 서버가 `/analyze-quote`를 제공하면 같은 카드 표시 흐름을 사용합니다.
- MinerU 서버가 없거나 실패하면 기존 Apps Script 추출 방식으로 자동 fallback합니다. HWP는 v1에서 수동확인으로 남기고, HWPX는 기존 XML 텍스트 추출을 보조로 사용합니다.
- MinerU 서버 요청 형식은 `POST /analyze-quote`이며 입력은 `fileName`, `mimeType`, `fileBase64`, `caseId`입니다. 응답은 `markdown`, `json`, `tables`, `vendorName`, `items`, `supplyAmount`, `vatAmount`, `totalAmount`, `confidence`, `warnings`를 받을 수 있습니다.
- 견적 금액은 합계/견적금액/청구금액 같은 라벨과 공급가액+부가세 계산을 우선하며, 날짜·수량·호실처럼 보이는 작은 숫자는 합계 후보에서 제외합니다. 기존 잘못된 견적 카드는 목록에서 제거 후 재업로드하세요.
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

## 카카오 알림톡 테스트

1. NCP SENS `bring_care_kakao` 프로젝트에 `@bringcare` 채널과 아래 템플릿이 모두 승인 상태인지 확인합니다.
   - `BRINGRECEIPTTENANTV1`
   - `BRINGRECEIPTOWNERV1`
   - `BRINGOWNERQUOTEV1`
   - `BRINGRENTREMINDERV1`
2. Apps Script의 스크립트 속성에 설치 순서 8의 카카오 설정값을 추가합니다.
3. 최초 테스트에서는 `KAKAO_SMS_FAILOVER_ENABLED=false`, `KAKAO_ALIMTALK_ENABLED=true`로 설정합니다.
4. 함수 선택에서 `testKakaoAlimTalkSetup`을 실행합니다.
5. `@bringcare` 이름으로 세입자 민원 접수 테스트 알림톡이 도착하고 실행 로그에 `provider: kakao_alimtalk`이 표시되는지 확인합니다.
6. 실제 테스트 민원 한 건을 접수해 ② 세입자·건물주 알림톡과 ⑧ 추천 견적 버튼이 현재 케이스의 승인 화면으로 연결되는지 확인합니다.
7. 검증이 끝난 후 NCP 채널에서 SMS 대체 발송을 설정했다면 `KAKAO_SMS_FAILOVER_ENABLED=true`로 변경합니다.

월세 납부 안내용 `BRINGRENTREMINDERV1` 템플릿은 아래 내용 그대로 등록하고 검수를 요청합니다. 변수명과 줄바꿈이 달라지면 발송이 거절될 수 있습니다.

```text
[BRING Care 월세 납부 안내]
#{세입자명}님, 안녕하세요.

#{안내문구}
건물: #{건물명}
호실: #{호실}
납부금액: #{납부금액}원
납부일: #{납부일}

이미 납부하셨다면 확인까지 시간이 걸릴 수 있으니 이 알림톡은 무시해 주세요.
```

## 카카오 챗봇 민원 접수 테스트

1. Apps Script에서 `setupKakaoComplaintIntake`를 한 번 실행합니다.
2. 실행 로그의 카카오 챗봇 스킬 URL을 챗봇 관리자센터 스킬 엔드포인트로 등록합니다. URL에 포함된 토큰은 외부에 공개하지 않습니다.
3. 챗봇의 `민원 접수` 블록과 폴백 블록에 같은 스킬을 연결합니다.
4. 봇 테스트에서는 `KAKAO_CHATBOT_INTAKE_ENABLED=false` 상태로 기존 구글폼 안내 응답이 표시되는지 먼저 확인합니다.
5. 챗봇 관리자센터의 봇 ID를 `KAKAO_CHATBOT_BOT_ID`에 저장하고 `KAKAO_CHATBOT_INTAKE_ENABLED=true`로 변경합니다.
6. `현장 사진 등록` 블록을 만들고 `@sys.plugin.secureimage`를 필수 파라미터 `secureimage`로 연결합니다. 같은 스킬을 적용한 뒤 블록 ID를 `KAKAO_CHATBOT_PHOTO_BLOCK_ID`에 저장합니다.
7. 챗봇 사진은 카카오 보안 URL 만료 전에 접수 시 Drive의 `카카오 민원 사진/{접수번호}` 폴더로 복사되며, 시트와 Firebase 케이스의 사진 필드에 연결됩니다.
6. `민원 접수`를 입력하고 건물명부터 개인정보 동의까지 진행합니다.
7. 카카오톡에 발급된 접수번호가 Google 응답 시트와 Firebase `/cases/{접수번호}`에 생성되는지 확인합니다.
8. 1분 이내 `카카오 처리 상태=완료`로 바뀌고 FM 대시보드에서 같은 접수번호가 표시되는지 확인합니다.
9. `내 민원 조회`를 입력해 최근 케이스의 현재 상태가 카카오톡에 표시되는지 확인합니다.

## ② 접수확인 문자 테스트

1. Apps Script를 웹 앱으로 배포한 뒤 FM 앱 케이스 화면에서 ② `SENS 문자`를 누릅니다.
2. 처음 사용하는 경우 자동화 웹앱 URL에 Apps Script 웹 앱 URL을 저장합니다.
3. 구글폼에서 생성된 케이스는 응답 시트의 원본 연락처를 우선 사용하고, 수동 생성 케이스는 케이스의 연락처 값을 사용합니다.
4. 발송 결과는 케이스 ② 메모와 응답 시트의 `문자 발송 상태`, `문자 발송 메모`에 반영됩니다.

## ⑥ 견적 파일 업로드 테스트

1. ⑤가 완료되어 ⑥이 `진행중`인지 확인합니다.
2. ⑥ 메모 버튼을 열고 견적 파일을 선택합니다. 여러 파일을 한 번에 선택해도 됩니다.
3. 파일은 PDF, JPG/JPEG, PNG, DOC/DOCX, XLS/XLSX, HWP/HWPX만 가능하며 최대 5MB입니다. HWPX는 텍스트 자동 추출을 시도하고, HWP는 원본 저장 후 수동 확인 상태로 남깁니다.
4. 업체가 1곳만 선택되어 있으면 자동으로 그 업체에 연결됩니다. 여러 곳이면 파일 본문에서 업체명을 추출하고, 애매하면 `업체 확인 필요`로 남깁니다.
5. 처음 사용할 때는 `caseAutomationEndpoint`에 Apps Script 웹 앱 URL을 저장합니다. ⑤ MMS 웹앱 URL과 같은 URL을 사용해도 됩니다.
6. 업로드 후 선택한 파일 수만큼 케이스 ⑥ 카드에 `원본 열기`, `엑셀 견적서` 링크와 추출 상태가 표시되는지 확인합니다.
7. 업로드 직후 브링 양식은 `초안` 상태로 표시됩니다. 합계금액이 맞지 않으면 카드의 `합계금액 확인/수정`에 정확한 합계금액을 넣고 `브링 양식 재작성`을 누릅니다. 공급가액/부가세는 합계금액 기준으로 자동 계산되고 브링 양식 상태가 `확정`으로 바뀝니다.
8. PDF/JPG/PNG 추출을 테스트하려면 Apps Script 왼쪽 `서비스`에서 `Drive API`가 추가되어 있는지 확인합니다. 매니페스트에는 `Drive API v3` 설정이 포함되어 있습니다.

## ⑤ 업체 MMS 견적 요청 테스트

1. 구글폼 테스트 민원에 JPG/JPEG 사진을 첨부합니다.
2. FM 앱 케이스에서 ⑤ 메모를 열고 업체 후보 중 발송할 업체를 선택합니다.
3. ⑤ `업체 발송`을 누른 뒤 자동화 웹앱 URL에 Apps Script 웹 앱 URL을 저장합니다.
4. `MMS 발송 요청`을 누릅니다.
5. 발송 결과는 케이스 ⑤ 메모와 기록에 자동 반영됩니다.

발신번호가 승인 대기 중이면 SENS API가 실패 응답을 줄 수 있습니다. 이 경우 케이스 ⑤는 완료되지 않고 `진행중/보류`로 남습니다.
