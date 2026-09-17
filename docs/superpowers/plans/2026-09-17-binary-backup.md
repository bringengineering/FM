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
