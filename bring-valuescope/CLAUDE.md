# CLAUDE.md — BRING ValueScope

## 1. 프로젝트 목적
BRING ValueScope는 원룸·다가구 및 중소형 수익형 건물의 매입·운영·가치상승
의사결정을 지원한다. 핵심 출력은 투자점수 하나가 아니라 다음 수치와 근거다.

- 권장 매입가 / 절대 상한가(Walk-away Price)
- 필요 자기자본 / 안정화 NOI
- LTV / LTC / DSCR / Debt Yield / Cash-on-Cash / IRR
- 손익분기 점유율 / 실질 레버리지
- 하방 시나리오 생존 가능성
- GO / Conditional GO / Review / NO-GO

## 2. 절대 원칙
1. 핵심 숫자를 LLM이 계산하지 않는다. Python 결정론적 엔진이 계산한다.
2. 금액 계산은 `Decimal`을 사용한다. `float` 사용 금지.
3. 모든 외부 데이터에는 출처·기준일·원본 식별자·신뢰등급을 저장한다.
4. 공식 감정평가와 시스템 추정가를 명확히 분리한다.
5. LTV·DSR·세율 등 제도값을 코드에 하드코딩하지 않는다. 견적/버전으로 관리한다.
6. 시나리오 결과는 입력값 버전과 계산엔진 버전을 저장해 재현 가능해야 한다.
7. 기존 시나리오를 덮어쓰지 않는다. 복제 후 새 버전을 만든다.
8. Hard Stop은 총점으로 상쇄할 수 없다.
9. 입력 데이터가 부족하면 임의 추정하지 않고 REVIEW/데이터요구를 반환한다.
10. 개인정보·계약서·등기 관련 값은 로그에 남기지 않는다.
11. 법률·세무·감정·대출 가능성을 확정적으로 표현하지 않는다.
12. 모든 추천에는 가정·근거·민감도·신뢰도를 함께 제공한다.

## 3. 현재 구현 범위 (EPIC 01 — Financial Underwriting Core)
`packages` 대신 단일 설치형 패키지 `valuescope`(src 레이아웃)로 구현했다.
개념 매핑:

- `valuescope.domain`   ← packages/domain (Money·Rate·RentRoll·Loan·SourcesAndUses)
- `valuescope.calculators` ← packages/calculators (amortization·metrics·irr·cashflow)
- `valuescope.engine`   ← scoring/scenario (underwrite·scenario·solver·decision)
- `apps/api`            ← FastAPI thin layer

이후 EPIC(건축물대장·실거래가·비교사례·리포트)에서 `data_connectors`,
`reports` 를 추가한다.

## 4. 기술 스택 (목표)
- Web: Next.js + TypeScript · API: FastAPI + Python 3.11+
- DB: PostgreSQL + PostGIS · Sensor: TimescaleDB · Cache: Redis · S3
- Tests: pytest / Vitest / Playwright · pnpm · Docker Compose

## 5. 개발 규칙
1. 돈 계산에 `float` 금지, `Decimal` 사용.
2. 모든 비율은 저장단위(분수)와 표시단위(%)를 분리한다.
3. 금융 공식을 바꾸면 테스트를 먼저 추가하고 `ENGINE_VERSION`을 올린다.
4. 계산 결과에는 `engine_version`을 저장한다.
5. 시나리오는 수정하지 않고 새 버전으로 복제한다(`dataclasses.replace`).
6. AI가 생성한 숫자를 핵심 재무결과로 저장하지 않는다.
7. 한국 시간대·원화 기본, 통화 확장성 유지.

## 6. 테스트 / 품질
- `pytest` — 단위·시나리오·솔버·의사결정·골든케이스 (현재 160+ 통과)
- 골든 케이스 10종은 검증 유형(정상·고LTV·보증금과다·공실·공사비·금리·재감정·매각·데이터부족·수익미달)
- 핵심 재무계산 오차 0원 또는 명시된 반올림 범위
- 보고서 숫자는 시나리오 결과와 100% 일치, JSON == 화면

## 7. AI 사용 범위
허용: 서류 요약·누락 데이터 안내·리스크 설명·보고서 초안·비교사례 설명
금지: NOI·IRR·LTV·DSCR·매입가 등 핵심 숫자 생성, 법적·대출 가능성 확정, 공식 감정가 표방

## 8. 실행
```bash
pip install -e ".[dev]"        # 테스트
pytest
python -m valuescope.cli examples/sample_deal.json
pip install -e ".[api]" && uvicorn apps.api.main:app --reload
```
