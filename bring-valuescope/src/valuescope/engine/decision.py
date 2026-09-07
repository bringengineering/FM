"""GO / CONDITIONAL_GO / REVIEW / NO_GO with non-negotiable hard stops.

CLAUDE.md rule 8: a hard stop cannot be offset by a high score. This module
encodes that literally — any hard stop forces NO_GO regardless of how attractive
the returns look.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from decimal import Decimal
from enum import Enum
from typing import Dict, List, Optional

from ..domain.money import Money
from .scenario import ScenarioResult
from .solver import SolverResult
from .underwrite import DealInputs, UnderwriteResult


class Verdict(str, Enum):
    GO = "GO"
    CONDITIONAL_GO = "CONDITIONAL_GO"
    REVIEW = "REVIEW"
    NO_GO = "NO_GO"


@dataclass(frozen=True)
class DataFlags:
    """Completeness of the data a decision legally depends on."""

    deposit_data_complete: bool = True
    senior_lien_data_complete: bool = True
    refinance_dependent: bool = False  # does the base case only work if refi succeeds?


@dataclass(frozen=True)
class DecisionResult:
    verdict: Verdict
    hard_stops: tuple[str, ...]
    conditions: tuple[str, ...]
    top_risks: tuple[str, ...]
    recommended_price: Optional[Money]
    walkaway_price: Optional[Money]
    asking_price: Money

    def to_dict(self) -> dict:
        money = lambda m: (None if m is None else int(m.rounded().amount))  # noqa: E731
        return {
            "verdict": self.verdict.value,
            "hard_stops": list(self.hard_stops),
            "conditions": list(self.conditions),
            "top_risks": list(self.top_risks),
            "recommended_price": money(self.recommended_price),
            "walkaway_price": money(self.walkaway_price),
            "asking_price": money(self.asking_price),
        }


def _base_hurdles_met(res: UnderwriteResult, deal: DealInputs) -> bool:
    t = deal.targets
    if res.irr is None or res.irr < t.target_irr:
        return False
    if res.dscr is not None and res.dscr < t.min_dscr:
        return False
    if res.cash_on_cash is not None and res.cash_on_cash < t.min_cash_on_cash:
        return False
    if res.real_leverage > t.max_real_leverage:
        return False
    return True


def decide(
    deal: DealInputs,
    base: UnderwriteResult,
    scenarios: Dict[str, ScenarioResult],
    solver: SolverResult,
    data: DataFlags = DataFlags(),
) -> DecisionResult:
    t = deal.targets
    hard_stops: List[str] = []
    conditions: List[str] = []
    top_risks: List[str] = []

    downside = scenarios.get("downside")

    # --- Hard stops (cannot be offset) ---------------------------------------
    if downside is not None:
        d = downside.result
        if d.dscr is not None and d.dscr < t.min_downside_dscr:
            hard_stops.append(
                f"하방 DSCR {d.dscr.quantize(Decimal('0.01'))} < 최소 {t.min_downside_dscr} "
                "(스트레스 시 원리금 상환 불가)"
            )
        if d.net_sale_proceeds.amount < 0:
            top_risks.append("하방 시나리오에서 매각가가 대출잔액에 미달 (자기자본 전액 잠식)")

    if base.dscr is not None and base.dscr < Decimal("1.0"):
        hard_stops.append(
            f"기준 DSCR {base.dscr.quantize(Decimal('0.01'))} < 1.0 (기준 시나리오에서 상환 불가)"
        )

    if data.refinance_dependent:
        hard_stops.append("수익이 재감정·대환 성공에만 의존 (재대출 실패 시 성립 불가)")

    # --- Data-required (professional review before a verdict) -----------------
    data_required: List[str] = []
    if not data.deposit_data_complete:
        data_required.append("임차보증금·선순위 자료 미확인")
    if not data.senior_lien_data_complete:
        data_required.append("선순위 채권(근저당 등) 자료 미확인")

    # --- Risk surfacing (non-blocking) ---------------------------------------
    if base.real_leverage > t.max_real_leverage:
        top_risks.append(
            f"실질 레버리지 {base.real_leverage.quantize(Decimal('0.01'))} > 상한 {t.max_real_leverage} "
            "(대출+승계보증금 합산)"
        )
    if base.break_even_occupancy is not None and base.break_even_occupancy > Decimal("0.85"):
        top_risks.append(
            f"손익분기 점유율 {(base.break_even_occupancy * 100).quantize(Decimal('0.1'))}% "
            "(공실 여유 적음)"
        )
    if downside is not None and downside.result.irr is not None and downside.result.irr < 0:
        top_risks.append("하방 시나리오 IRR 음수 (원금 손실 구간)")

    # --- Verdict --------------------------------------------------------------
    walkaway = solver.walkaway_price if solver.feasible else None
    recommended = (walkaway * Decimal("0.97")).rounded() if walkaway is not None else None
    asking = deal.purchase_price

    if hard_stops:
        verdict = Verdict.NO_GO
    elif data_required:
        verdict = Verdict.REVIEW
        conditions.extend(data_required)
    else:
        base_ok = _base_hurdles_met(base, deal)
        asking_within = walkaway is not None and asking <= walkaway
        if base_ok and asking_within:
            verdict = Verdict.GO
        else:
            verdict = Verdict.CONDITIONAL_GO
            if not asking_within and walkaway is not None:
                conditions.append(
                    f"매도호가 {int(asking.rounded().amount):,}원 > 절대 상한가 "
                    f"{int(walkaway.rounded().amount):,}원 → 가격 인하 필요"
                )
            if not base_ok:
                if base.irr is None or base.irr < t.target_irr:
                    conditions.append("목표 IRR 미달 → 매입가 인하 또는 가치상승안 강화 필요")
                if base.dscr is not None and base.dscr < t.min_dscr:
                    conditions.append("목표 DSCR 미달 → 대출조건 조정 또는 매입가 인하 필요")

    return DecisionResult(
        verdict=verdict,
        hard_stops=tuple(hard_stops),
        conditions=tuple(conditions),
        top_risks=tuple(top_risks[:5]),
        recommended_price=recommended,
        walkaway_price=walkaway,
        asking_price=asking,
    )


__all__ = ["Verdict", "DataFlags", "DecisionResult", "decide"]
