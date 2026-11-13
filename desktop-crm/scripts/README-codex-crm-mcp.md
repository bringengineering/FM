# Codex ↔ BRING CRM 업무지시 연결

## 무엇이 되는가

Codex 대화에서 관리자 세션으로 담당자 계정과 미완료 업무지시 요약을 읽고, 새 업무지시를 구조화해 CRM 필수 항목을 미리 검증할 수 있습니다. 조회와 미리보기 단계는 저장하지 않습니다. 대표가 미리보기 내용을 확인한 뒤 현재 대화에서 명시적으로 승인하면, 실행 중인 BRING CRM의 로그인 관리자 세션을 통해 기존 `saveProject` / `saveWorkOrder` 경로에 저장합니다. 담당자에게 문자·이메일·메신저를 보내지는 않습니다.

## 1회 설치

Windows PowerShell에서 이 저장소의 `desktop-crm` 폴더로 이동한 뒤 실행합니다.

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install-codex-crm-mcp.ps1
```

기본 사용자 데이터 경로는 `%APPDATA%\bring-crm-desktop`입니다. 앱이 다른 `userData` 경로를 쓰는 환경에서는 `-UserDataPath`로 CRM의 실제 경로를 지정해야 합니다. 설치기는 같은 이름의 MCP 설정을 임의로 덮어쓰지 않습니다. 제거하려면 `-Remove`를 사용합니다.

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install-codex-crm-mcp.ps1 -Remove
```

CRM을 실행하고 로그인한 다음 Codex를 완전히 재시작해야 새 도구가 표시됩니다. CRM은 업무지시를 발행하는 동안 계속 실행 중이어야 합니다.

## 사용 순서

1. `crm_work_order_context`로 담당자 UID와 미완료 업무의 중복 여부를 확인합니다. 업무 목적·내용·완료 기준, 예상 시간, 마감일, 산출물 종류·이름·수량을 정합니다.
2. `crm_preview_work_order_draft`로 검증된 미리보기를 보여 줍니다. 이 호출은 CRM에 저장하지 않습니다.
3. 대표가 내용과 담당자를 검토하고 이 대화에서 명시적으로 발행을 승인한 뒤에만 `crm_publish_work_order_draft`를 호출합니다.
4. 결과에서 각 업무지시의 성공/실패를 확인합니다. 일부 실패를 전체 성공으로 처리하지 않습니다.

미리보기는 10분 동안 유효합니다. 변경이 있으면 반드시 새 미리보기를 만듭니다. 세션은 BRING CRM의 현재 관리자 로그인으로 매번 확인됩니다.

## 보안 범위

- 로컬 PC의 `127.0.0.1`에서만 통신하며 앱 실행마다 임의 bearer token을 만듭니다.
- MCP에는 연결 상태 조회, 담당자·미완료 업무 요약 조회, 미리보기, 발행만 노출됩니다. 고객 데이터 조회나 범용 DB 쓰기는 없습니다.
- Firebase 토큰과 서비스 계정 비밀키를 Codex로 전달하지 않습니다.
- 미리보기만으로는 어떤 CRM 기록도 바뀌지 않습니다. 발행은 대표의 별도 승인을 요구합니다.
