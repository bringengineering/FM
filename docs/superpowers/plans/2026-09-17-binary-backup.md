# 원본 포함 R&D 백업 구현 계획

사용자가 승인한 자료 보존·회사 CRM 통합 범위를 이어서 구현한다. 기존 metadata-only 백업을 전체 파일 백업으로 이름만 바꾸지 않는다. 운영 배포·계정 전환은 수행하지 않는다.

1. 원본 바이트와 JSON metadata를 함께 묶는 ZIP writer를 추가한다. 기존 텍스트 ZIP은 20MiB를 유지하고 바이너리 ZIP은 총100MiB, 안전한 상대 경로, CRC와 파일 크기를 검증한다. 한도 초과는 복사 전에 거부한다.
2. 회사 Drive adapter에 신뢰된 내부 원본 다운로드 경로를 추가한다. 현재 회사 root·소유권·고정 버전·artifact/project·파일 크기·SHA-256을 검증하며, streaming 한도와 세션 검사를 적용한다. token/bytes를 renderer IPC 응답에 제공하지 않는다.
3. Main 백업 service는 renderer의 프로젝트 ID만 받고 승인된 공유 프로젝트·관계·기준선·감사 기록을 직접 읽는다. 자료 버전 참조를 열거·중복 정리하고 원본을 내려받아 metadata와 바이너리별 해시 manifest를 생성한다. 외부 문헌 링크, 접근 실패 또는 불완전 참조가 있으면 범위를 명시하며 전체 복구 가능 백업으로 표시하지 않는다. 필수 회사 원본 누락은 생성 중단한다.
4. 작업 시작부터 저장창·partial 파일·최종 rename까지 client/로그인 세대와 현재 권한을 고정한다. 조회 후 프로젝트 revision을 다시 확인하고 변경 시 중단한다. 자동 Drive/DB 쓰기·업로드·삭제는 없다.
5. 회사 CRM의 기존 백업 버튼 옆에 원본 포함 경로를 연결한다. 크기·파일 수·완료 범위와 원본 제외 여부를 실제 manifest에 맞춰 표시한다. 복원은 신규 대상·관계 대조·원본 해시 확인 및 명시 승인으로 별도 구현한다.
6. 실제 ZIP 파서로 비UTF8 원본·CRC·manifest/hash·변조·누락·세션 변경·저장 취소·용량 초과를 검증한다. Native/packaged 경로와 별도 회사 Drive·두 PC·빈 workspace 복구 검증까지 완료하기 전 OPS-01 PASS로 올리지 않는다.

현재: writer, trusted downloadVersion, 참조 열거 builder, Main의 승인된 bounded 공유 snapshot 조회·권한·저장창·partial 저장 및 preload와 CRM 버튼 연결을 구현했다. UI는 미공유 초안·입력·저장·업로드를 차단하며 프로젝트/연결/로그인 세대 변경 시 오래된 결과를 표시하지 않는다. Node 558개와 실제 Electron 화면·preload·Main 로컬 회사 접근 차단 3개가 통과했다. 다운로드→builder 및 UI 완료 경로는 fixture 시험이며 실제 회사 Drive 성공·전체 복원은 미완료다. manifest의 fullBackup false/restoreReady false와 OPS-01 미통과 상태를 유지한다.


보관본 검증 구현: zip-reader는 앱이 생성한 stored/classic ZIP의 central/local header·offset·CRC·경로·중복·104MiB 파일/100MiB 내용/1002 항목 한도를 검사한다. 파일 시스템 추출은 하지 않는다. verifier는 fatal UTF-8 JSON·manifest와 metadata 해시를 확인하고 metadata 원본 참조를 다시 열거해 모든 원본의 크기·SHA·버전·프로젝트 및 파일 목록을 대조한다. 누락·여분·변조·세션 변경을 거부한다. originVerified false로 회사 출처 인증과 내부 무결성을 구분한다. Node562 및 독립 검토 통과. verifier의 Main 파일 선택/UI 연결과 실제 회사 원본 복원은 다음 단계다. 최신 Windows b8c042f에는 보관 UI/113개 소스/packaged34 PASS가 포함되며 이번 ZIP reader/verifier는 아직 미포함이다.


보관본 검증 Main/UI 연결: renderer 인자를 받지 않는 rndInspectOriginalBackup을 추가했다. 시작 세대와 현재 관리자 권한 확인 후 Main의 openFile 선택만 사용하고 FileHandle로 256KiB씩 총104MiB/초기크기 한도 내 읽으며 크기 변경·세션 변경 시 중단, handle을 항상 닫는다. 원본 목록/해시 및 프로젝트·방문·감사 domain 검사 후 원본 바이트/경로 없이 고정 개수·검증 범위 요약만 반환한다. CRM의 기존 secondary 스타일 버튼은 오래된 세대 결과를 표시하지 않는다. 실제 Electron 로컬 차단4 PASS, 실제 로컬 ZIP 읽기/production builder/domain validator 통합1 PASS. 회사 출처·전체 복원 미검증을 유지한다. 다음은 원본 복원 검토와 관계 대조/신규 대상 복구 구현이다.


추가 공유 metadata 원본 누락 수정: additionalMetadata는 JSON으로만 보관되고 고정 원본 열거에서는 빠져 있었다. builder가 이 영역도 동일한 한도·참조 검증·중복 정리 대상으로 열거한다. 알려지지 않은 collection의 참조는 명시 projectId가 필요하며 불완전/외부 프로젝트/같은 파일ID 다른 버전은 다운로드 전에 거부한다. builder→verifier 연결과 collection 간 dedup/collision 회귀3개 포함 Node569 PASS. fullBackup/restoreReady/originVerified false는 유지하며 실제 회사 출처·전체 복원은 미완료다.


동결 데이터셋 소속 검증: prepareOriginalBackupSnapshot에서 manifestHash와 별개로 dataset.projectId가 부모 project.id와 일치하는지 확인한다. createDatasetSnapshot으로 생성한 해시 정상 q 데이터셋을 p에 붙이는 기존 통과를 회귀 시험으로 확인한 뒤 거부하도록 수정했다. 정상 q 연결은 유지한다. 전체 Node570 PASS. 이 경로는 Main 원본 보관과 보관본 검증의 domain 검사 양쪽에서 사용된다. 실제 회사 Drive·전체 복원/61개 인수는 미완료 상태다.


원본 복원 사전검토 기반: createOriginalRestorePreview는 bounded ZIP을 실제 verifier로 읽고 source/current 프로젝트·기준선·감사 domain 및 연구 참조 연결을 검증한다. 프로젝트·기준선·감사 ID 충돌은 기존 대상을 덮어쓰지 않고 신규 대상 ID가 필요하다고 표시하며 신규 기록도 승인된 생성이 필요하다. 모든 원본은 복구 후 새 회사 Drive 원본 검증이 필요한 항목으로 기록한다. 원본/현재 해시는 향후 승인 및 CAS 재조회용 일관성 근거이며 출처 인증이 아니다. 원본bytes·전체metadata를 반환하지 않고 canApply/restoreReady/originVerified false와 cloudWrites false를 유지한다. 실제 비UTF8 원본을 넣은 ZIP의 검토, 충돌, 잘못된 연구 연결, 변조ZIP, 세션 변경 시험 포함 Node572 PASS. Main/UI 검토 연결·대상 mapping·원본 복구 실행은 다음 단계다. Windows60caed6에는 이번 preview 기반이 아직 포함되지 않는다.


복원 검토 Main/preload 연결: createOriginalRestoreReview는 renderer 인자를 거부하고 Main 파일선택/한도 읽기/관리자·시작 세대 확인 후 authoritative 공유 root를 조회·domain 검증하고 실제 ZIP preview를 생성한다. 전후 ETag와 원본 root JSON 해시가 다르면 결과를 중단한다. 검토 결과는 적용 불가와 읽기 전용 상태를 유지한다. Main/preload rndReviewOriginalRestore을 연결했으며 actual Electron 로컬 접근 차단5개 및 전체 Node574 PASS, 독립 검토 중요한 문제 없음. UI 검토 목록/대상 mapping/승인된 실제 원본 복구는 다음 단계다. Windows60caed6은 이번 preview/review/Main API 미포함이고 실제 회사 성공/전체 복원은 미완료다.


복원 검토 CRM 화면 연결: 기존 secondary 버튼과 details 패널로 Main의 무인자 API를 호출해 프로젝트·기준선·감사 충돌과 원본 재업로드 목록을 50개씩 표시한다. textContent만 사용하며 프로젝트/로그인/연결/검토 지우기의 매번 새 generation으로 오래된 완료/실패를 차단하고 기존 목록을 지운다. 적용 버튼은 아직 없다. 실제 Electron Main 로컬 차단·UI fixture HTML 비실행/페이지/ A-B-A/clear/logout 등10 PASS, Node574 PASS, 독립 검토 중요한 문제 없음. 정상 화면 결과는 fixture이고 회사 원본/실제복원 성공은 미검증이다. 다음은 신규대상 mapping 및 승인된 원본 복구 실행이다.


빈 작업공간 복원검토 지원: trusted snapshot reader의 allowEmptyRoot는 기본 false이며 Main 복원검토에서만 true이다. valid ETag와 실제 JSON null을 받은 경우 value:{} 및 emptyRoot:true로 명시적으로 정규화한다. 배열/primitive/버전없음은 계속 거부하고 원본 보관은 null을 거부한다. 검토 전후 ETag·정규화 root 해시·emptyRoot flag를 함께 대조해 null에서 {}로 바뀌는 상황도 중단한다. 결과의 sharedEmptyRoot가 정규화 범위를 표시하며 root 해시는 raw HTTP 서명이 아니다. 전체 Node576 PASS. 실제 회사 빈 workspace·전체 복원 실행은 미검증이며 Windows13c48fe은 이번 수정 미포함이다.


원본 복원 대상 매핑 기반: createOriginalRestoreMapping은 Main 내부 fresh preview/current ID 목록을 전제로 프로젝트·기준선·감사의 모든 source ID에 정확히 하나의 신규 target ID를 지정한다. 현재 ID와 충돌·target 중복·누락/여분·부모 프로젝트 누락을 거부한다. 기준선·감사·원본의 targetProjectId는 프로젝트 매핑에서만 유도하며 source SHA/ZIP/current 해시를 mappingSHA에 묶는다. 원본은 새 업로드 검증 계획이며 immutable 감사 기록의 재작성 또는 기존 Drive ID 자동 재사용은 수행하지 않는다. 실제 비UTF8 원본 ZIP→검증 preview→mapping 통합 및 거부 시험3개 포함 전체 Node579 PASS. canApply/cloudWrites/originVerified/restoreReady false. Main/UI 매핑 입력·승인된 실제 복구·회사 실검증은 다음 단계다. Windows5653c53은 이번 mapping 미포함이다.


Main 내부 복원 매핑 세션 기반: 검토 preview/actor/SDK binding/current ID는 trusted add로만 등록하고 renderer mapping은 previewId와 targets만 받는다. 최대3건·10분·preview4MiB 한도이며 권한/시작 SDK 세대·record identity·만료를 access await 전후에 확인한다. 매핑 전후 authoritative root ETag/정규화empty/hash를 재검증하고 실패 시 검토를 삭제한다. clear/eviction은 대기 중 결과도 무효화한다. 실제 clear during readSnapshot 및 마지막 async access 회귀3개 포함 전체 Node582 PASS. 현재는 내부 세션 기반만 구현했으며 Main API 등록·UI 매핑 입력·원본 복구 실행은 다음 단계다. Windows5653c53에는 이번 mapping/session 기반 미포함이다.


복원 매핑 Main/preload 연결: review가 최신 root 재확인 후 trusted onReview callback으로 preview/actor/private SDK binding/currentIds를 Main store에 등록하고 다시 session 검사한다. Main store는 client identity마다 고정 database/token/fetch reader를 사용하며 client 변경 시 이전 store를 clear한다. rndMapOriginalRestore은 입력 previewId/targets만 세션 mapper에 전달하고 첫 approval await 전 SDK generation을 고정한다. 전체Node583, 실제Electron localguard/fixture화면11 PASS, 독립 검토 중요한 문제 없음. 매핑 정상 회사 성공·UI 대상입력·원본 복원실행은 미연결/미검증. Windows5653c53은 이번 store/API 수정 미포함이다.


복원 매핑 CRM 입력 연결: 프로젝트·기준선·감사마다 기본 restored-UUID 신규 ID를 제안하고 변경할 수 있다. 페이지 입력은 collection별 Map에 보관하며 API에는 previewId/targets만 보낸다. 잘못된 ID 입력을 사전 거부하고 Main의 읽기전용 결과 kind/previewId/flag/hash를 대조한다. 입력 변경/editVersion 및 review generation/dispose로 늦은 매핑 결과를 차단하고 검토 재조회/clear/로그인 변경 시 입력·결과를 비운다. Native13 PASS(회사 Main localguard+UI fixture), Node583 PASS, 독립 검토 중요한 문제 없음. 회사 정상 매핑·실제 복원 실행은 미검증/미연결. Windows5653c53에는 이번 mapping UI/API 기반 미포함이다.


매핑 입력 오류 수정 재검증: 기존 모든 error에서 review를 삭제해 단순 target ID 충돌 후 수정 재검증이 불가능했다. pre/post validateCurrent의 로그인/권한/만료/공유 root/record 무효화 오류만 review를 삭제하고 순수 target map 검증 오류는 유효 review를 보존한다. 재요청은 사용자 명시 입력 수정이며 자동 재시도·실행·쓰기 없음. 같은 review ID로 새 record가 등록된 경우 이전 실패는 새 record를 삭제하지 않는다. 실제 mapper 충돌→수정성공→root변경무효화 및 clear/lastaccess 기존회귀 포함 Node584 PASS. 실제 회사 매핑/원본 복원은 미검증. Windowsa9d3420은 이번 retry 수정 미포함이다.


복원 원본의 Main 내부 준비: review의 trusted filepicker 경로를 onReview/private store에만 기록하고 IPC 결과에는 포함하지 않는다. store.prepare는 기존 mapping freshness 검증 후 bounded 파일 재읽기·검토 당시 ZIP SHA 일치·actual ZIP 원본 verifier·세션/현재 root 재검증을 거쳐 내부 작업에만 mapping/verified source bytes를 반환한다. prepare IPC/preload는 없고 일반 매핑 API는 계속 bytes 없는 결과만 반환한다. 파일 변경·읽기/무결성 실패·로그인/자료 변경은 review를 무효화한다. 실제 비UTF8 원본 ZIP→preview→private preparation/hash변조 거부 회귀 포함 Node585 PASS. 신규 대상 자료 생성·Drive 원본 업로드·승인된 복구 실행은 다음 단계이며 회사 성공 미검증. Windows25fdfa7은 이번 private source 준비 미포함이다.


복원 원본의 새 대상 연결 준비: private store.prepare에서 실제 ZIP 재검증 이후 prepareRestoreOriginals를 실행한다. source record SHA·metadata manifest SHA·mapping SHA·프로젝트 부모 연결·원본 inventory·크기/SHA를 확인하고 source provider/project/artifact/version/hash를 출처로 보존한다. 새 target project와 mapping에 고정된 artifact/version ID를 생성하며 같은 artifact의 여러 버전은 새 artifact를 공유한다. 원본은 독립 Buffer로 복사하고 중복 참조는 inventory 기준 한 건으로 준비한다. mapping은 첫 await 이전에 복사해 지연 권한 검사 중 호출자 변경이 결과에 반영되지 않는다. 실제 비UTF8 ZIP/중복참조·변조거부·세션경계·입력소유권 회귀 포함 Node589 PASS. cloudWrites/canApply/restoreReady=false이며 새 IPC나 실제 업로드·공유복원 실행은 없다. 다음 단계는 승인된 업로드 실행, 지속 복구 기록, 원본 참조 교체와 동결 데이터/불변 감사의 출처 보존이다. 전체 운영 인수5/61 및 회사 Drive/전체복원 미검증 상태는 유지한다.


원본 복원 파일명 보존: trusted Drive download가 실제 name에서 정확한 versionId__ 접두어만 제거하고 MIME과 함께 반환한다. builder는 optional fileName을 기존 확장자/실행파일/경로 정책으로 검사하고 MIME을 제한한 뒤 inventory에 보관한다. verifier는 optional 필드를 동일한 정책으로 재검사하고 전체 key/value를 대조하며 과거 필드 없는 ZIP도 읽는다. private restore plan은 fileName/MIME을 전달하고 이름 없는 과거 보관본은 requiresFileName=true로 표시한다. 이름은 보관본의 서술 정보이며 회사 출처 인증을 뜻하지 않는다. 실제 업로드/공유 복원은 아직 미연결. Drive→builder→ZIP검증 및 private 준비/잘못된 경로 회귀 포함 Node590 PASS.


원본 복원 재업로드 coordinator: createOriginalRestoreUploader는 trusted Main 내부에만 있고 enabled=false가 기본이며 현재 IPC/버튼에는 연결하지 않는다. prepare/check/authorize/journal/upload adapter를 요구한다. 전체 batch 파일 정책·크기/SHA·중복 버전을 첫 전송 이전에 확인하고 독립 복사하며 mapping/sourceZIP에 결합한 관리자 승인을 검사한다. journal.begin은 영속/원자적 단일 예약이라는 필수 계약으로 전송보다 앞서 실행하고 per-file 시작/검증완료/결과미확인 기록을 append한다. Drive 반환 중 로그아웃되어도 최초 actor의 완료 receipt를 먼저 보존한 뒤 실패한다. exact target/hash/size에 맞는 검증미완료 recovery 파일ID만 기록하며 자동재시도/공유 DB 쓰기는 없다. 주입 adapter 시험6개/Node596 PASS; 실제 영속 journal 구현·Main 연결·회사 업로드 성공은 아직 미구현/미검증. Windows3da07e5에는 coordinator 미포함이다.


복원 업로드 영속 원장 구현: createOriginalRestoreJournal은 계정별 최대100개의 atomic quota directory와 UID/mapping/sourceZIP에 고정된 attempt directory로 독립 writer의 중복 예약을 차단한다. manifest/event는 wx partial 파일·FileHandle.sync·exclusive directory 내 rename으로 공개하며 저장 도중 남은 slot은 보존하고 incomplete로 조회한다. terminal/start 슬롯은 overwrite하지 않고 source/target/hash/size와 event schema를 쓰기·읽기 모두 검증한다. read는 파일당1MiB bounded buffer이며 UID 조회를 격리한다. 검토에서 발견한 pre-existing Windows junction 외부쓰기 문제를 actual 재현 후 root조상부터 target까지 lstat/realpath guard로 수정했다. 실제 디스크 재개·동시writer·quota·partial·tamper읽기·uploader+realjournal replay·Windows junction 9개/전체Node605/독립검토 PASS. privileged OS 동시directoryswap·정전 내구성·회사 출처 인증을 주장하지 않는다. Main버튼/승인실행 연결 및 회사Drive 성공은 아직 미연결/미검증; Windows3da07e5에는 journal/coordinator 미포함이다.


복원 이력 Main/preload 연결: noargs rndOriginalRestoreHistory API를 추가하고 Main 첫 approval 전에 SDK binding을 고정한다. 회사 localtest는 disk 접근 전에 거부하며 Main userData 원장 singleton을 사용한다. service는 현재 관리자 UID/email/role/password/session을 disk await 전후 확인하고 ownUID 최대100개 요약만 반환한다. file/events/path/bytes 없이 verified/uncertain/pending 수와 상태를 제공하고 restoreReady/databaseWrites=false를 유지한다. 입력/viewer/async session변경 및 actualMain VM 초기guard 회귀 포함 Node609 PASS. UI 표시·업로드 승인실행 연결·실제회사 성공 미완료; Windows3da07e5는 이번 API 미포함.


복원 업로드 이력 CRM 화면 연결: 별도 details 패널에 noargs 조회 버튼과20건 pagination을 추가하고 Main 요약의 flag/status/count/attemptID를 검사해 textContent로만 표시한다. 실제 복원완료가 아닌 업로드기록임을 안내한다. session/project/connection 세대 및 dispose는 기존/늦은결과를 비우며 stale finally가 새 버튼 상태를 바꾸지 않는다. 기존 CRM secondary 버튼과 폰트/스타일을 사용한다. 단위3개·전체Node612·실제Electron Main/preload localguard 포함14개 PASS. 양성표시 단위시험은 fixture이며 회사 정상조회/실제복원/업로드 승인실행 미검증이다.


원본 재업로드 Main/preload 실행 연결: rndUploadOriginalRestore는 previewId/targets만 받고 BRING_RND_ORIGINAL_REUPLOAD_ENABLED=1에서만 실행한다(기본off/운영설정변경없음). Main 시작 SDK를 첫 await전에 고정하고 mutationguard/currentapprovedadmin/localtestdeny/globalbusy를 적용한다. 실행 service는 freshadmin UID/email/SDK와 private sessions.mapping의 authoritative root를 매 guard에서 재확인한다. DriveREADY와 private original ZIP 준비/전체batch정책을 검사한 후 native cancel-default 승인창에 파일수/bytes/대상과 sourceZIP/mapping SHA·출처미인증·공유복원별도 안내를 표시한다. 승인 후 private영속journal과 companyDrive adapter를 사용한다. cancel/권한/SDK변경/잘못된 IPC입력/Drive연결없음 회귀3개+MainVM/실제Electronlocalguard 포함 Node616/native15/독립검토 PASS. 실제회사 업로드/공유복원성공 및 UI버튼 연결은 아직 미완료.


원본 재업로드 CRM 버튼 연결: 검토 panel에 secondary 실행 버튼을 추가한다. 유효한 같은 editVersion의 mapping receipt와 원본이 있어야 enable하며 입력 수정/새검토/session/connection/project 변경은 무효화한다. IPC는 previewId/targets만 보내고 pending동안 input/load/clear/map을 잠근다. 반환sourceZIP/mapping/preview·flag·attemptID·expectedfilecount·project/refschema를 대조하며 textContent로 원본 업로드 완료와 공유복원 별도임을 표시한다. 결과불명확/error는 원장을 확인하게 안내하고 자동retry없이 mappingreceipt를 소비한다. 단위3개/전체Node619/실제Electron16(새 버튼양성매핑은fixture, 실제Mainlocaldeny) 및 독립검토 PASS. 실제회사 전송/공유복원은 미검증; runtimegate 기본off/운영설정변경없음.


복원 동결 데이터 파생 로직: createRestoredDatasetSnapshot은 Main 내부용이며 현재 공유복원 실행에는 미연결이다. 검증된 archival dataset과 trusted caller가 회사Drive에서 freshlyverified한 replacementrefs를 요구한다. source manifest/선정범위/기간/대상/계수/계획hash/동결형식을 검사하고 모든 source provider/artifact/version와 새 project/ref의 hash/size 대응을 대조한다. 전체 archival provider/version/artifact ID집합의 재사용 및 교차swap·누락/extra/중복을 거부한다. 원본을 변경하지 않고 source계획hash/unitIDs/rowCount를 유지하며 새 연결/현복원자/시각과 원래 manifest/frozenBy/At/sourceZIP/mapping hashes/priorRestore를 포함한 restoredFrom을 새manifest로 동결한다. originVerified/disclosureApprovalTransferred=false라 기존 공개승인을 자동승계하지 않는다. old author는 path가 아닌 provenance text로 보존한다. actualcreateSnapshot/validhash-butmalformedscope/2refequalbyteswap/provenance변조/복사독립/legacy author 6개 및 전체Node625/독립검토 PASS. helper는 직접Drive검증/승인/공유write를 수행하지 않으며 project연결/기존연구참조재결합과 회사전체복원 성공은 다음 단계다.

복원 업로드 재개와 참조 재검증: artifact/version target ID는 일회성 preview/mapping SHA 대신 source identity와 target project에 고정하여 새 검토 세션에서도 동일 대상을 사용한다. mapping/sourceZIP hashes는 별도 출처로 유지한다. 영속 journal.get은 현재 actor 소유권을 event 읽기 전에 검사하고 bounded/schema/path 검증을 재사용한다. Main-private reference verifier는 현재 private prepare의 sourceZIP/전체 target 대응과 own-actor 완료 원장을 대조한 뒤 모든 파일을 Drive.verifyVersion으로 다시 읽어 hash/size/context를 검증한다. 과거 attempt mapping은 sourceAttemptMappingSHA256으로 보존하며 현재 mapping을 대신 승인하지 않는다. UNCERTAIN/partial/다른 actor/변경된 ZIP/중복 receipt는 Drive 호출 이전에 거부한다. 반환은 고정 URL과 참조 필드만 포함하며 bytes/token/공유write/복원완료를 포함하지 않는다. production Drive adapter HTTP fixture에서 binary full-content 검증→새 dataset manifest 파생을 확인했다. 실제 회사 OAuth 성공이 아닌 fixture이며 verifier의 Main IPC/UI 및 전체 공유복원 연결은 아직 미완료다. focused reference4/recovery15 및 전체 Node631 PASS; runtime gate 기본off/전체 인수5/61 유지.

복원 원본 재검증 Main/CRM 연결: IDs-only rndVerifyOriginalRestore API는 첫 async approval 전 SDK를 고정하고 local 회사 read를 adapter 생성 전에 거부한다. Main 실행 bridge는 현재 admin UID/email/password/session·authoritative sessions.mapping·DriveREADY를 모든 단계에서 확인하고 private prepare/journal.get/Drive.verifyVersion에 연결한다. 경로/bytes/actor/승인을 renderer에서 받지 않고 공유write/업로드를 수행하지 않는다. CRM 작업ID 입력과 secondary 재검증 버튼은 현재 mapping receipt/원본/64자리 attempt SHA를 요구하고 처리 중 대상/작업ID/load/clear/map/upload를 잠근다. sourceZIP/현재mapping/attempt/전체sourceprovider 및 신규target/refschema를 대조하고 reset/logout/project/connection 변경의 늦은결과를 폐기한다. 업로드 성공의 attemptID를 입력에 채우며 공유복원 별도임을 안내한다. execution3/Main1/UI3 및 전체Node638/독립검토 PASS. 실제Main/preload 로컬거부와 fixture 매핑→실제Main거부 경로를 확인했으며 회사 양성조회/전체 공유복원은 아직 미검증이다. 기본 재업로드gate off/운영설정변경없음/전체인수5/61 유지.

Windows CI 원장 경로 회귀 수정: CI8e424ad 원장8개 실패의 path-changed 오류를 actual COM ShortPath로 로컬재현했다. 경로 guard는 Windows ~digits component 별칭에서만 bigint lstat의 nonzero inode·동일 dev/inode/type인 canonical 폴더를 허용한다. pre-existing symlink/junction은 fallback 전에 계속 거부하며 다른 inode canonical 매핑도 거부한다. 원장11/전체Node639 및 독립검토 PASS. CI 최신 결과는 별도 진행 중이며 로컬결과로 CI통과를 주장하지 않는다. 공유write/defaultgate/운영설정 변경은 없다.

검증 원본 기반 프로젝트 파생: deriveRestoredProject는 Main-private helper이며 현재 공유복원 쓰기/IPC에는 미연결이다. trusted ZIP/mapping·fresh Drive refs를 받아 source 프로젝트/연구 링크와 전체 source file/artifact/version/hash/size 대응을 검사한다. 다른 source artifact 병합과 archival ID 재사용·누락/extra/손상된 데이터셋을 거부한다. item IDs는 새 artifact ID에 맞추고 종속 itemId/artifactId/fixed version labels를 함께 바꾼다. 새 dataset manifest·실험/근거/수치의 manifest 연결, 관측/followup의 parent를 파생하되 원래 actor/time/result를 보존한다. fixed attachment가 있는 frozenPlan의 새 planHash를 일관되게 반영하고 원래 planHash를 dataset provenance에 보존한다. 전체 원본 project JSON과 SHA는 descriptive archivalProjectJSON으로 exact 보존해 기존 감사·승인·TRL 판정이 유실되지 않고 live backup 참조 스캐너가 old bindings를 현재 파일로 오인하지 않는다. 새 currentTRL/assessments/hypothesisAssessments/disclosureApprovals는 승계하지 않고 승인 item/evidence는 review, approved/running experiment는 draft로 만들며 기존 approvedBy/At/selfReview metadata를 제거한다. source8MiB/derived20MiB·100k nodes/depth64·1000files/100MiB 제한을 적용한다. createProject/dataset/disclosure/observation/followup 실제 factory·정상 item/artifact 연결·approval isolation·plan attachment·artifact merge·builder→ZIP verify roundtrip6 및 production Drive HTTP fixture→receipt verifier→project derivation을 포함해 전체Node645/독립검토 PASS. 실제회사 remote success/visit·불변 import audit 파생/공유쓰기/전체복원은 아직 미완료; runtimegate off/전체인수5/61 유지. Windows 경로 수정109ae62의 GitHub CI35171615889는 success로 확인했고 이번 파생 변경 CI는 별도다.

기준선 복원 파생: deriveRestoredVisits는 Main-private helper이며 공유복원 실행/IPC에는 미연결이다. trusted current mapping의 전체 hash·visit sourceSHA·source/target project 부모·유일 target ID와 원래 revisit chain을 검사한다. 새 visit/project/revisit parent ID와 revision0을 파생하고 restorationSourceRevision 및 시간·비용·작성자·측정 데이터를 보존한다. 원래 visit JSON/sourceSHA/sourceZIP/mapping SHA는 descriptive provenance에 exact 보존한다. fixedrefs는 fresh replacement의 source project/file/artifact/version/hash/size와 대조하고 전체 archival file/version/artifact ID 재사용·crossswap 및 duplicate targets를 거부한다. evidenceUrl은 대응 fixedref가 있을 때 canonical 새 Drive URL로 바꾸고 일반외부 링크는 unverifiedEvidenceLinkCount로 남긴다. direct visit root fixedbinding은 원래 부모로 검사한 뒤 새 부모로 연결한다. source8MiB/derived20MiB·100k nodes/depth64·1000refs/100MiB 제한. source edit/mapping tamper/duplicate/missingparent·fixedref·equalbytes crossswap·metadata backup/read roundtrip·root binding6/전체Node651/독립검토 PASS. DB/Drive write/복원권한을 부여하지 않는다. CSV import audit은 원래 actor·jobJSON·dryrun/rollback·integrity에 고정되어 단순 project/job ID rewrite가 불가능함을 확인했으며 다음 단계에서 exact archival audit을 별도 출처로 보존하는 복원 모델이 필요하다. 실제회사 성공/공유전체복원/운영인수5/61 및 runtimegate off는 유지한다.
