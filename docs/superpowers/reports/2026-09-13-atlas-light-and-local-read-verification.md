# A안 및 검증 모드 조회 오류 수정

## 결과

- 밝은 아이보리 층판, 옅은 외벽/격자, 장식 그림자, 밝은 라벨을 적용했다. 선택 설비의 분류색은 유지하고 파란 링으로 표시하며 직접 연결된 경로만 강조한다.
- `BRING_CRM_LOCAL_ONLY=1`에서는 remoteClient가 null인데 여섯 조회 IPC가 바로 호출하던 오류를 재현했다. GitHub 정리/운영 데이터 유실을 원인으로 입증한 것은 아니다.
- 검증 모드 조회는 매번 새 읽기 전용 빈 컬렉션을 반환한다. 운영 연결 미준비는 REMOTE_NOT_READY 오류이며 서버 실패를 빈 성공으로 숨기지 않는다.
- 명시적인 로컬 로드맵 demo만 기존 예시를 읽기 전용으로 표시한다. 운영 오류 시 예시를 대신 표시하던 기존 catch 경로는 제거했다.

## 검증 증거

- 최초 신규 조회 테스트 12개 실패: null.loadWorkOrders 등 오류 재현. 수정 후 통과.
- 실제 main handler와 renderer loader를 연결한 소비자 회귀 테스트 포함 최종 20개 통과. 운영 실패/미준비 상태가 demo 성공으로 바뀌지 않는다.
- 전체 CRM 1,984개 통과, 실패/스킵 0. 원본 upstream 29개 통과.
- 스펙 검토 통과. 품질 검토에서 로드맵 demo 회귀 발견 후 수정 및 재검토 승인.
- 브라우저 가상 자료에서 A안 렌더링, 설비 선택/확대, 층 분리, 390px 화면의 지도 버튼/범례를 확인했다. 가로 문서 폭390px 유지. 지도 스타일 조작 후 서버 쓰기0회.
- WebGL 강제 실패 fixture에서 기록 목록 대체 안내 확인.
- `--publish never`로 검증용 Windows EXE 재생성: 1.42.0-atlas.local.2, dist-atlas-verification-v2/win-unpacked.
- 패키지 EXE smoke exit0, initialized:true. 실제 renderer→IPC 경로로 loadForms/loadWorkOrders/loadDailyLogs/loadSupplies/loadDeliveryFlows/loadWorkReports 여섯 조회 성공 및 localOnly/read-only 검증.
- 새 검증용 EXE 창 실행/랜딩 확인. 네이티브 메뉴 클릭은 화면 전환이 관측되지 않아 수동 메뉴 탐색 완료로 기록하지 않는다. 여섯 조회 경로 검증 근거는 위 패키지 IPC smoke다.

## 운영 상태 및 제한

- origin 운영 브랜치는 여전히 1889ef252c10e2bdf6b5de46329aae2cf240b482.
- 운영 push, Rules/Functions/Hosting 배포, 자동업데이트 공개, 운영 자료 변경 없음. 설치된 CRM에 이 수정이 반영되었다고 주장하지 않는다.
- 검증용 창은 회사 서버와 연결되지 않으므로 업무 입력용으로 사용하지 않는다. 이전 검증용 창과 운영 창을 강제로 종료하지 않았다.
- 실제 운영 사용자 계정으로 이번 오류를 재현/조회한 것은 아니다. 운영 설치본에서도 같은 오류가 있으면 해당 실행 경로/로그인 초기화 상태를 별도로 확인해야 한다.
- GPU 장시간 메모리 계측 및 설치형 자동업데이트 검증은 이번 범위 밖이다.
