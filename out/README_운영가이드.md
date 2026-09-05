# BRING 주간 업무지시서 운영 가이드 (Claude Code / Codex 공용)

이 폴더(`out/`)만 있으면 **Claude Code든 Codex든** 동일하게 주간 업무지시서를
만들고 텔레그램으로 발송할 수 있습니다. AI에게는 **"이 README대로 진행해줘"** 라고만
하면 됩니다.

---

## 1. 구성 파일

| 파일 | 역할 |
|---|---|
| `BRING_주간업무지시서_템플릿(빈양식).xlsx` | 마스터 템플릿 (4개 시트: 운영규칙·업무지시서·완료보고서·관리대장) |
| `generate_directive.py` | 입력(JSON) → 지시서 xlsx 생성 (주차 자동계산·행 확장·수식/검증 재정합) |
| `send_telegram.py` | 생성한 xlsx를 텔레그램으로 발송 (토큰은 환경변수로만) |
| `config.example.json` | 수신자 chat_id 별칭 예시 → `config.json` 으로 복사해 사용 |
| `directive_input.example.json` | 지시서 입력 예시 |
| `주간입력_양식.txt` | 사람이(또는 GPT가) 채우는 자연어 입력 양식 |

> 생성된 실제 지시서(예: `BRING_주간_김현진_2026-W36.xlsx`)도 이 폴더에 함께 보관됩니다.

---

## 2. 매주 흐름 (표준 운영 절차)

1. **대표**가 이번 주 핵심과제(+선택: 담당자 가용시간)를 전달.
2. **AI**가 `directive_input.example.json` 형식의 입력을 구성.
3. `python generate_directive.py input.json` 으로 지시서 생성
   → **오늘 날짜 기준 이번 주차·마감으로 자동 최신화** (지난 주차 재사용 금지).
4. **대표 확인(컨펌)** — 외부(팀원) 발송 전 반드시 대표에게 파일을 먼저 보여주고 승인받는다.
5. 승인되면 `python send_telegram.py --to <별칭> --file <xlsx> --caption-file msg.txt` 로 발송.
6. 결과 파일을 git commit / push.

> **원칙**: 세부 마감은 두지 않고 **금요일 보고 하나**로 통일. 학생 담당자는 가용시간 내
> 중요도순으로 하고 초과분은 다음 주로 이월. 마감이 있는 건(예: 지원사업)은 공고 마감을 우선.

---

## 3. 지시서 생성 — `generate_directive.py`

```bash
python generate_directive.py directive_input.example.json
# 또는
python generate_directive.py input.json -o 결과.xlsx
```

**입력 JSON 주요 필드** (`directive_input.example.json` 참고)

| 필드 | 설명 |
|---|---|
| `week_monday` | `null`=실행일 기준 이번 주 자동 / `"2026-08-31"`=해당 주 고정 |
| `doc_no_suffix` | 문서번호 끝자리(담당자 구분). 예: 현진 `"01"`, 우중 `"02"` |
| `recipient` / `dept_role` | 수신 담당자 / 소속·직무 |
| `background`/`goal`/`loss` | §1 배경·이번 주 목표·미달 시 손실 |
| `scope_include` (≤8) / `scope_exclude` / `precondition` / `scope_change` | §2 범위 |
| `unified_friday_deadline` | `true`면 모든 업무 마감 = 금요일 17:00 |
| `tasks[]` | `name·purpose·done·deliverable·location·priority·hours·weight` |

- **가중치(weight) 합계는 1.0(=100%)** 이어야 발행 가능. 아니면 경고 출력.
- 업무 개수 N에 맞춰 §3 표와 완료보고서 시트가 자동 확장/축소되고 수식·병합·드롭다운·결재란이 재정합됨.
- 우선순위 드롭다운: `최우선 / 높음 / 보통 / 낮음`.

---

## 4. 텔레그램 발송 — `send_telegram.py`

```bash
export TELEGRAM_BOT_TOKEN="<봇 토큰>"        # @BotFather 발급, 저장소에 절대 넣지 않음
cp config.example.json config.json           # 최초 1회
python send_telegram.py --to hyunjin --file BRING_주간_김현진_2026-W36.xlsx --caption-file msg.txt
python send_telegram.py --to 8739295337 --file 결과.xlsx --caption "안내 문구"
```

- 봇: `@bring_task_bot` (수신자가 봇에 먼저 `/start` 하거나 봇을 그룹에 초대해야 chat_id가 잡힘).
- chat_id 별칭은 `config.json` 에서 관리 (비밀 아님). **토큰만 환경변수**.
- 표준 라이브러리만 사용(별도 설치 불필요). 단, `generate_directive.py`는 `openpyxl` 필요:
  `pip install openpyxl`.

---

## 5. 대표 확인(승인) 후에만 하는 것 (안전 원칙)

- 팀원에게 **실제 발송** (항상 대표 컨펌 후)
- 가격 변경·할인, 광고 예산/키워드 변경
- 외부 기관 최종 제출
- 개인정보/계약서 외부 공유, 원본 파일 삭제

---

## 6. 담당자별 표준 역할 (2026년 하반기 기준)

- **대표(서창환)**: 회사 방향·핵심 목표 제시, 고객 연락·상담, 입·퇴실 패키지 상품 정의.
- **김현진(운영관리팀장)**: CRM·고객센터·운영 프로세스·월간보고서·진행상황 AI 자동화 등.
- **황우중**: (당분간) 온라인 마케팅 6채널(네이버 블로그·숨고·네이버 플레이스·구글 드라이브·당근·카카오톡 채널) 운영·기록·분석.
  - 참고: 시험 일정 등으로 가용시간이 달라질 수 있으므로 과부하 금지.

---

## 7. 보안 메모

- **봇 토큰은 저장소에 커밋 금지.** 항상 `TELEGRAM_BOT_TOKEN` 환경변수로만 전달.
- `config.json`(실사용본)에 민감정보가 들어가면 `.gitignore` 처리 권장. chat_id 자체는 비밀 아님.
