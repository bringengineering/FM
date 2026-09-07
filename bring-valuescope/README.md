# BRING ValueScope

> 원룸·다가구 및 중소형 수익형 건물을 **사도 되는지, 얼마까지 사야 하는지,
> 무엇을 개선해야 가장 높은 수익과 자산가치가 발생하는지**를 계산하는
> 건물 투자·가치상승 의사결정 플랫폼.

이 저장소는 그 플랫폼의 **첫 번째 코어 — Financial Underwriting Core (EPIC 01)**
이다. 공공 API도, AI도 없이, 순수 `Decimal` 결정론적 엔진으로 딜의 재무 타당성을
계산한다. 이 계산기가 정확해야 그 위에 실거래가·상권·리트로핏 추천을 올릴 수 있다.

## 무엇을 계산하나

주소·매도호가·Rent Roll·운영비·대출조건을 입력하면:

- 필요 자기자본 · 안정화 NOI · 월/연 현금흐름
- LTV · LTC · DSCR · Debt Yield · Cash-on-Cash · Cap Rate
- 5년 IRR · NPV · Equity Multiple · 예상 매각가
- 손익분기 점유율 · 실질 레버리지(임차보증금 포함)
- **최대 매입가 (절대 상한가 / Walk-away Price)**
- 현상유지 · 기준 · 상방 · 하방 4개 시나리오
- **GO / CONDITIONAL_GO / REVIEW / NO_GO** + Hard Stop + Top 5 리스크

## 설계 원칙 (요약)

- 금액은 `float`가 아닌 `Decimal`. 1원 단위 재현 가능.
- 핵심 숫자는 LLM이 만들지 않는다 — 결정론적 Python 엔진이 계산한다.
- 임차보증금은 초기 자기자본을 줄이지만 **반환의무(부채)** 로 별도 계산한다.
- LTV·금리 등 제도값을 하드코딩하지 않고 견적으로 받는다.
- Hard Stop은 높은 점수로 상쇄할 수 없다.
- 모든 결과에 `engine_version` 을 저장해 재현 가능.

전체 계산식은 [`docs/formulas.md`](docs/formulas.md), 용어는
[`docs/glossary.md`](docs/glossary.md) 참고.

## 구조

```
src/valuescope/
├─ domain/        Money·Rate·Period, RentRoll, OperatingStatement, LoanQuote, SourcesAndUses
├─ calculators/   amortization(3방식), metrics(비율), irr/npv, 5년 cashflow
├─ engine/        underwrite → scenario(4종) → solver(최대매입가) → decision(GO/NO_GO)
├─ io_json.py     딜 JSON 로더 · CSV 내보내기
└─ cli.py         python -m valuescope.cli <deal.json>
apps/api/         FastAPI thin layer (POST /analyze, /max-price)
tests/            unit · golden_cases (160+ 통과)
examples/         sample_deal.json
```

## 빠른 시작

```bash
python -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"

pytest                                            # 전체 테스트
python -m valuescope.cli examples/sample_deal.json   # 딜 분석 → JSON
python -m valuescope.cli examples/sample_deal.json --csv

pip install -e ".[api]"
uvicorn apps.api.main:app --reload                # http://127.0.0.1:8000/docs
```

### 예시 출력 (sample_deal.json)

```
verdict: GO
walkaway(절대 상한가): 1,272,626,968원
recommended(권장 매입가): 1,234,448,159원
stabilized NOI: 78,720,000원
DSCR 1.57 · IRR 27.7% · downside DSCR 1.04
```

## 법적 표현 원칙

시스템 출력은 **공식 감정평가서가 아니라 ‘참고용 추정가 및 투자 시뮬레이션’**
이다. 공식 감정가·대출 승인·법적 적합성을 확정적으로 표현하지 않으며, 모든
추천은 가정·민감도·신뢰도와 함께 제시한다.

## 로드맵

EPIC 01(현재) → 건축물대장·실거래가 연동 → 비교사례 엔진 → 시나리오 확장 →
Building Value Report(PDF) → 실제 건물 파일럿.
