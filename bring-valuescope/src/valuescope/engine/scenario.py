"""Scenario engine — the four mandatory scenarios and their stress deltas.

Scenarios never mutate a deal in place (CLAUDE.md rule 7): each is a *cloned*
DealInputs with deltas applied, so the base case and its scenarios are all
independently reproducible.
"""

from __future__ import annotations

from dataclasses import dataclass, replace
from decimal import Decimal
from typing import Dict

from ..domain.money import Rate
from ..domain.rent_roll import RentRoll, Unit
from .underwrite import DealInputs, UnderwriteResult, underwrite


def _scale_rents(rr: RentRoll, factor: Decimal) -> RentRoll:
    new_units = tuple(
        replace(u, monthly_rent=u.monthly_rent * factor) for u in rr.units
    )
    return RentRoll(units=new_units, currency=rr.currency)


@dataclass(frozen=True)
class ScenarioDelta:
    """A named set of deltas applied to a base deal."""

    name: str
    rent_multiplier: Decimal = Decimal("1")
    vacancy_delta: Decimal = Decimal("0")       # additive, in rate points
    rate_delta: Decimal = Decimal("0")          # additive, annual rate points
    capex_multiplier: Decimal = Decimal("1")
    exit_cap_delta: Decimal = Decimal("0")      # additive
    rent_growth_delta: Decimal = Decimal("0")   # additive
    construction_months_delta: int = 0
    zero_capex: bool = False
    refinance_available: bool = True            # informational; used by decision

    def apply(self, base: DealInputs) -> DealInputs:
        rr = base.rent_roll
        if self.rent_multiplier != Decimal("1"):
            rr = _scale_rents(rr, self.rent_multiplier)

        new_rate = Rate(base.financing.rate.value + self.rate_delta)
        financing = replace(base.financing, rate=new_rate)

        new_vacancy = max(Decimal("0"), base.vacancy_rate + self.vacancy_delta)
        stab = base.stabilized_vacancy_rate
        new_stab = None if stab is None else max(Decimal("0"), stab + self.vacancy_delta)

        capex = base.capex * Decimal("0") if self.zero_capex else base.capex * self.capex_multiplier

        return replace(
            base,
            rent_roll=rr,
            financing=financing,
            vacancy_rate=new_vacancy,
            stabilized_vacancy_rate=new_stab,
            capex=capex,
            exit_cap_rate=max(Decimal("0.0001"), base.exit_cap_rate + self.exit_cap_delta),
            rent_growth=base.rent_growth + self.rent_growth_delta,
            revenue_loss_months_year1=min(
                12, base.revenue_loss_months_year1 + self.construction_months_delta
            ),
        )


# The four mandatory scenarios (EPIC 01 Story 8). Deltas match the stress table.
STATUS_QUO = ScenarioDelta(name="status_quo", zero_capex=True)
BASE = ScenarioDelta(name="base")
UPSIDE = ScenarioDelta(
    name="upside",
    rent_growth_delta=Decimal("0.01"),
    vacancy_delta=Decimal("-0.02"),
    exit_cap_delta=Decimal("-0.005"),
)
DOWNSIDE = ScenarioDelta(
    name="downside",
    rate_delta=Decimal("0.02"),          # 금리 +2%p
    vacancy_delta=Decimal("0.10"),       # 공실 +10%p
    rent_multiplier=Decimal("0.90"),     # 임대료 -10%
    capex_multiplier=Decimal("1.20"),    # 공사비 +20%
    construction_months_delta=6,         # 공기 +6개월
    exit_cap_delta=Decimal("0.01"),      # Exit Cap +1%p
    refinance_available=False,           # 재대출 0원
)

DEFAULT_SCENARIOS = (STATUS_QUO, BASE, UPSIDE, DOWNSIDE)


@dataclass(frozen=True)
class ScenarioResult:
    delta: ScenarioDelta
    deal: DealInputs
    result: UnderwriteResult


def run_scenarios(base: DealInputs, deltas=DEFAULT_SCENARIOS) -> Dict[str, ScenarioResult]:
    out: Dict[str, ScenarioResult] = {}
    for d in deltas:
        deal = d.apply(base)
        out[d.name] = ScenarioResult(delta=d, deal=deal, result=underwrite(deal))
    return out


__all__ = [
    "ScenarioDelta",
    "ScenarioResult",
    "STATUS_QUO",
    "BASE",
    "UPSIDE",
    "DOWNSIDE",
    "DEFAULT_SCENARIOS",
    "run_scenarios",
]
