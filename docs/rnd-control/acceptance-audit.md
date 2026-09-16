# 원래 기획서 61개 검수 항목 대조

410개 Node 시험 및 Windows 화면 시험 통과는 61개 전체 검수 통과를 뜻하지 않습니다. 부분 구현과 시험 근거를 기록했지만 실제 운영 계정·원본 복구·배포 검수를 대신하지 않습니다. NOT_RUN은 해당 범위 전체가 아직 검증되지 않았다는 의미입니다.

| ID | 종합 결과 | 현재 근거와 남은 작업 |
|---|---|---|
| AUTH-01 | NOT_RUN | 비로그인 DB 거부 시험 있음. 화면 세션 접근·공개 메타데이터 별도 검수 필요 |
| AUTH-02 | NOT_RUN | Main 별도 rndAccess 승인 확인·관리자 조회/승인/취소 UI·감사 요청 연결·ETag 충돌 처리 및 Emulator 거부 시험 구현. 실제 승인 회사 계정 2개 운영 검수 필요 |
| AUTH-03 | NOT_RUN | 계정 이메일/역할 변경·실시간 로그인 이벤트 우선·초안/자료/승인 폼 초기화·늦은 응답 차단 구현. 실제 권한 취소 후 두 PC와 Drive 연결 회수 검수 필요 |
| AUTH-04 | NOT_RUN | 서버 viewer 쓰기 거부 확인. 승인·import 직접 호출 추가 시험 예정 |
| AUTH-05 | NOT_RUN | 서버의 미지정 계획 승인 거부 확인. 근거 승인 우회 추가 시험 예정 |
| AUTH-06 | NOT_RUN | 자기검토 사유·여부 저장. 별도 계정 수동 검수 필요 |
| AUTH-07 | NOT_RUN | 실계정 또는 수동 시나리오 검수가 필요함 |
| PRJ-01 | NOT_RUN | 기본 프로젝트 자동 생성 제거. CRM 앱의 빈 상태·생성 취소·명시적 생성 확인. 빈 운영 workspace 실계정 검수는 남음 |
| PRJ-02 | PASS | 명시 적용으로 H0~H7 8개 생성, core 6개·장기 H7 분리, 모두 NOT_TESTED. 모델·CRM 앱·서버 시험 확인 |
| PRJ-03 | NOT_RUN | 프로젝트+체계+코드 ID와 근거 framework 연결 구현. 다른 체계 근거 거부 모델 시험 확인. import 연결 전 과정 추가 검수 필요 |
| PRJ-04 | NOT_RUN | 산출물 모델 승인 검증 있음. 서버 승인 필드 검증 보완 |
| PRJ-05 | NOT_RUN | 필수/선택 구분 및 필수 0개 준비율 — 모델 시험 확인. 전체 운영 화면 검수는 남음 |
| PRJ-06 | NOT_RUN | 필수 승인 1/4와 준비율 25% 모델 확인. CRM 구분 저장 시험 확인 |
| PRJ-07 | NOT_RUN | 서버 원자적 revision 검사·클라이언트 충돌 안내. 비교·재적용 UI 필요 |
| PRJ-08 | NOT_RUN | Main operationId 생성·응답 유실 후 전체 내용 재조회 확인·재쓰기 금지 구현 및 모델 시험 확인. 프로세스 종료 후 영구 원장·실제 네트워크 장애 검수 남음 |
| EXP-01 | NOT_RUN | 미완성 초안 저장·작성자 보완·누락 계획 승인 거부 모델/서버/CRM 화면 시험 확인. 전체 시작 우회/보완 흐름 종합 검수는 남음 |
| EXP-02 | PASS | 원계획·결과 불변, 새 실험 ID/계획 revision/변경 이유/적용 대상 분리, 새 지정 검토자 승인 후 실행. 모델·CRM 앱·서버 시험 확인 |
| EXP-03 | NOT_RUN | inconclusive 종료 시험 확인. aborted·반대 결과 별도 검수 필요 |
| EXP-04 | NOT_RUN | 결측 사유·미점검 상태 엔터티 필요 |
| EXP-05 | NOT_RUN | 파일 수·행수·독립 대상 수 분리 저장 및 모델 시험 확인. 실제 100개 파일/3동 시나리오 추가 검수 필요 |
| EXP-06 | NOT_RUN | 데이터셋 대상·기간·제외 기준·독립 ID·보관 버전·manifestHash 동결 구현. Main의 Drive 바이트 재검증과 모의 해시 불일치 거부 시험 확인. 직접 요청 구조 규칙 강화와 실Drive 시험 필요 |
| EXP-07 | NOT_RUN | 실계정 또는 수동 시나리오 검수가 필요함 |
| FILE-01 | NOT_RUN | 실계정 또는 수동 시나리오 검수가 필요함 |
| FILE-02 | NOT_RUN | 회사 Drive 미설정 연결 거부. 상태 코드 통일 필요 |
| FILE-03 | NOT_RUN | 버전 ID 재사용 기반 서비스. 전송 중단 복구 실시험 필요 |
| FILE-04 | NOT_RUN | 메인 메모리 토큰·만료 처리. 실계정 만료 시험 필요 |
| FILE-05 | NOT_RUN | 원본 업로드 후 DB 저장 별도. 복구 원장·operationId 필요 |
| FILE-06 | NOT_RUN | 같은 version ID 재시도 재사용. 다중 실험 관계 엔터티 필요 |
| FILE-07 | NOT_RUN | 동시 업로드 리스·고아 파일 복구 목록 필요 |
| FILE-08 | NOT_RUN | 근거 source 고정·서버 변경 방지. ArtifactVersion 엔터티 확대 필요 |
| FILE-09 | NOT_RUN | 원격 파일 상태 재검증·현재 유효성 경고 필요 |
| FILE-10 | NOT_RUN | 업로드·Drive 원본 확인·DS 참조·복구 원장 한도를 100MiB로 정렬. Main 파일 선택과 Drive 서비스에서 승인 확장자·실행 바이너리 차단·큰 자료 링크 안내 구현. 경계·실행파일 위장 회귀 시험 통과. 실제 100MiB 전송·운영 형식 검수는 남음; 실제 100MiB 바이트의 모의 API 업로드/재사용/원본 스트림·변조 거절 시험 확인 |
| FILE-11 | NOT_RUN | 실계정 또는 수동 시나리오 검수가 필요함 |
| FILE-12 | NOT_RUN | 가변 링크와 보관 스냅샷 분류 필요 |
| FILE-13 | NOT_RUN | 원격 바이트 SHA256·크기·소유권·공용 root 경로·버전 확인 구현. 바이트 불일치 모의 거부 시험. 실제 공급자 전송 오류 시험 필요 |
| FILE-14 | NOT_RUN | 프로젝트별 미공유 경고 보강. 로그아웃 초안 정리 시험 필요 |
| EVD-01 | NOT_RUN | 실측 유형 등록 시 동결 자료와 직접 측정 확인 필요. 개선 주장에 기준·결과 동결 자료와 계산 버전 원장 연결을 강제. 실제 원본 수치 대조와 전체 승인 검수는 미완료 |
| EVD-02 | NOT_RUN | 미분류/실측/문헌/시뮬레이션/가정 유형·원출처·한계 표시 구현. 문헌 등록/검토·유형 변경 거부 서버 시험 확인. 모든 유형의 실제 자료·계산 검수 필요 |
| EVD-03 | NOT_RUN | 승인 source 변경 방지. 접근불가 경고·외부 묶음 제외 필요 |
| EVD-04 | PASS | 기준값 0·미측정·비유한 수치는 —와 계산 불가 사유. 실제 결과 0은 측정값으로 구별. 모델/CRM 계산 화면 및 오버플로 방지 시험 확인 |
| EVD-05 | NOT_RUN | 실계정 또는 수동 시나리오 검수가 필요함 |
| EVD-06 | NOT_RUN | 관리자 결정·승인 근거·이유·시각 저장. 후속업무 엔터티 필요 |
| CRM-01 | NOT_RUN | 별도 rndControl 경로. CRM 읽기전용 snapshot 어댑터 필요 |
| CRM-02 | NOT_RUN | 실계정 또는 수동 시나리오 검수가 필요함 |
| CRM-03 | NOT_RUN | Main GET 전용 CRM context와 프로젝트별 선택 ID·관계·보관 이유·SHA256·시각·당시 revision 고정 보관 구현. 일반 저장 변조/삭제 거부, DB append-only·동시 revision 시험, native 지연 편집/세션 정리 및 내부 Markdown 포함·검토용 제외 확인. 실제 회사 원장/두 PC, JSON 내용의 DB 출처 신뢰 보강 및 승인 복원 검수는 남음 |
| CRM-04 | NOT_RUN | JSON 보관/복원 있음. dry-run·충돌목록·rollback manifest 필요 |
| UX-01 | NOT_RUN | 실계정 또는 수동 시나리오 검수가 필요함 |
| UX-02 | NOT_RUN | 실계정 또는 수동 시나리오 검수가 필요함 |
| UX-03 | NOT_RUN | 세션 조회 메타데이터 색인·종류 필터·50개 페이지·범위 표시·10,000행 AND 검색/페이지 시험과 CRM 화면 이동 구현. 원격 10,000개 자료 성능·조회 누락 종합 시험은 남음 |
| UX-04 | NOT_RUN | 주요 UI textContent 사용. 위험 URL·CSV·전체 삽입 시험 필요 |
| UX-05 | NOT_RUN | 저장 실패 표시·세션 초안 유지. 네트워크 단절 실시험 필요 |
| OUT-01 | PASS | ID·공유 revision·출처·상대 엔터티 링크를 포함한 Markdown ZIP 구현. CRM 앱 출력·Python ZIP CRC/UTF-8/SHA256/크기/모든 상대 링크 확인. Vault 직접 쓰기 경로 없음 |
| OUT-02 | NOT_RUN | 관리자 검토용 공개 범위 승인·취소·연결 자료 bundleHash·불변 이력·선별 manifest 구현 및 모델/서버 시험 확인. 가정/문헌/실측 분류와 실제 Drive 승인 자료 묶음 검수 필요 |
| OUT-03 | NOT_RUN | GitHub 저장소/path/40자리 SHA·미고정 경고·링크/버전 불일치 차단·Markdown 출력 구현. 실제 원격 코드 존재·주장 근거와 수동 등록 검수는 남음 |
| OPS-01 | NOT_RUN | 빈 workspace 복원·관계·바이너리 해시 시험 필요 |
| OPS-02 | NOT_RUN | metadata-only/binaryFilesIncluded=false·생성시각·개수·revision·DS 파일 참조·SHA manifest 및 변조/목록 불일치 거부 구현. 실제 다운로드 파일과 모든 원본 참조 범위 검수 필요 |
| OPS-03 | NOT_RUN | 기존 CRM 포함 410개 Node 시험 및 Windows 기본/비활성 실행 시험 통과. 운영 배포·설정·계정·종합 릴리스 검수는 미완료 |
| OPS-04 | NOT_RUN | 운영 seed 기본 실행 없음. 복원은 해시/목록/관계 사전 검증 및 명시 확인 후 신규 초안만 추가, 같은 ID 유지. 모든 직접 호출·운영 dry-run 정책 검수 필요 |
| OPS-05 | NOT_RUN | 실계정 시험 미실행. 개발·Emulator 시험 지속 |
| OPS-06 | NOT_RUN | BRING_RND_ENABLED=0 시작 시 메뉴·Main R&D 요청 차단 및 데이터 삭제 없는 재활성 절차 구현. 실제 운영 자료/두 PC 복귀 검수는 남음 |
| OPS-07 | NOT_RUN | 서버 연구 이력/결정 삭제·수정 거부 시험. 산출물 이력 추가 검수 필요 |
