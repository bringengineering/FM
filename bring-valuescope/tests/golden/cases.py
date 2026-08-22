"""Ten archetypal golden cases (EPIC 01 Story 12).

Each case pins the *qualitative* underwriting outcome (verdict + a directional
invariant) rather than a single magic number, so the suite documents intent and
stays meaningful when a formula is deliberately revised (with ENGINE_VERSION
bumped). Numeric golden values validated against a spreadsheet live alongside as
range assertions where they add signal.
"""

from __future__ import annotations

from dataclasses import dataclass, replace
from decimal import Decimal
from typing import Callable, Optional

from valuescope import (
    DealInputs,
    FinancingSpec,
    InvestmentTargets,
    Money,
    Rate,
    RentRoll,
    Unit,
)
from valuescope.domain import OperatingExpenses
from valuescope.engine import DataFlags, Verdict


def _rent_roll(n: int, rent: int, deposit: int, occupied: Optional[int] = None) -> RentRoll:
    occ = n if occupied is None else occupied
    return RentRoll(
        units=tuple(
            Unit(
                unit_id=str(i),
                area_m2=Decimal("22"),
                deposit=Money.won(deposit),
                monthly_rent=Money.won(rent),
                market_rent=Money.won(int(rent * 1.1)),
                occupied=i <= occ,
            )
            for i in range(1, n + 1)
        )
    )


def _opex(total: int) -> OperatingExpenses:
    q = total // 4
    return OperatingExpenses(
        property_management=Money.won(q),
        repairs=Money.won(q),
        insurance=Money.won(q),
        utilities_common=Money.won(total - 3 * q),
    )


_DEFAULT_TARGETS = InvestmentTargets(
    target_irr=Decimal("0.12"),
    min_dscr=Decimal("1.25"),
    min_cash_on_cash=Decimal("0.04"),
    max_real_leverage=Decimal("0.80"),
)


def _deal(**kw) -> DealInputs:
    base = dict(
        rent_roll=_rent_roll(12, 650_000, 10_000_000),
        opex=_opex(10_200_000),
        purchase_price=Money.won(1_100_000_000),
        financing=FinancingSpec(ltv_target=Decimal("0.6"), rate=Rate.percent("4.5"), term_months=240),
        vacancy_rate=Decimal("0.05"),
        stabilized_vacancy_rate=Decimal("0.05"),
        capex=Money.won(60_000_000),
        exit_cap_rate=Decimal("0.048"),
        targets=_DEFAULT_TARGETS,
    )
    base.update(kw)
    return DealInputs(**base)


@dataclass(frozen=True)
class GoldenCase:
    name: str
    deal: DealInputs
    expected_verdict: Verdict
    data: DataFlags = DataFlags()
    invariant: Optional[Callable] = None  # (analysis) -> bool
    invariant_desc: str = ""


GOLDEN_CASES: tuple[GoldenCase, ...] = (
    GoldenCase(
        name="01_normal_income_deal",
        deal=_deal(),
        expected_verdict=Verdict.GO,
        invariant=lambda a: a.base.dscr >= Decimal("1.25") and a.base.irr >= Decimal("0.12"),
        invariant_desc="base clears DSCR and IRR hurdles",
    ),
    GoldenCase(
        name="02_high_ltv_low_dscr",
        deal=_deal(
            financing=FinancingSpec(ltv_target=Decimal("0.80"), rate=Rate.percent("6"), term_months=240),
        ),
        expected_verdict=Verdict.NO_GO,
        invariant=lambda a: a.scenarios["downside"].result.dscr < Decimal("1.0"),
        invariant_desc="downside DSCR falls below 1.0",
    ),
    GoldenCase(
        name="03_excessive_deposits",
        deal=_deal(rent_roll=_rent_roll(12, 650_000, 40_000_000)),
        # deposits shrink cash equity but blow real leverage past the 0.80 cap,
        # so this is a leverage-risk CONDITIONAL_GO, not a clean GO.
        expected_verdict=Verdict.CONDITIONAL_GO,
        invariant=lambda a: a.base.real_leverage > Decimal("0.80"),
        invariant_desc="assumed deposits push real leverage above the max-leverage cap",
    ),
    GoldenCase(
        name="04_high_vacancy",
        deal=_deal(
            rent_roll=_rent_roll(12, 650_000, 10_000_000, occupied=7),
            vacancy_rate=Decimal("0.40"),
            stabilized_vacancy_rate=Decimal("0.40"),
        ),
        expected_verdict=Verdict.NO_GO,
        invariant=lambda a: a.base.current_noi < a.base.stabilized_noi
        or a.base.dscr < Decimal("1.25"),
        invariant_desc="high vacancy erodes NOI/coverage",
    ),
    GoldenCase(
        name="05_capex_overrun",
        deal=_deal(capex=Money.won(400_000_000)),
        expected_verdict=Verdict.CONDITIONAL_GO,
        invariant=lambda a: a.base.required_equity > Money.won(600_000_000),
        invariant_desc="large capex inflates required equity and depresses returns",
    ),
    GoldenCase(
        name="06_rate_shock",
        deal=_deal(
            financing=FinancingSpec(ltv_target=Decimal("0.70"), rate=Rate.percent("7.5"), term_months=240),
        ),
        expected_verdict=Verdict.NO_GO,
        invariant=lambda a: a.scenarios["downside"].result.dscr < Decimal("1.0"),
        invariant_desc="high base rate + downside bump breaks coverage",
    ),
    GoldenCase(
        name="07_refinance_dependent",
        deal=_deal(),
        expected_verdict=Verdict.NO_GO,
        data=DataFlags(refinance_dependent=True),
        invariant=lambda a: any("대환" in h or "재대출" in h for h in a.decision.hard_stops),
        invariant_desc="refinance-dependent deals are auto-blocked",
    ),
    GoldenCase(
        name="08_exit_cap_expansion",
        deal=_deal(exit_cap_rate=Decimal("0.075"), targets=replace(_DEFAULT_TARGETS, target_irr=Decimal("0.15"))),
        expected_verdict=Verdict.CONDITIONAL_GO,
        invariant=lambda a: a.decision.asking_price > a.decision.walkaway_price,
        invariant_desc="exit cap expansion drops the value one should pay below asking",
    ),
    GoldenCase(
        name="09_missing_data",
        deal=_deal(),
        expected_verdict=Verdict.REVIEW,
        data=DataFlags(deposit_data_complete=False),
        invariant=lambda a: len(a.decision.conditions) > 0,
        invariant_desc="incomplete rights data forces professional review",
    ),
    GoldenCase(
        name="10_below_target_return",
        deal=_deal(targets=replace(_DEFAULT_TARGETS, target_irr=Decimal("0.35"))),
        expected_verdict=Verdict.CONDITIONAL_GO,
        invariant=lambda a: a.decision.hard_stops == (),
        invariant_desc="return below an aggressive hurdle -> conditional, not blocked",
    ),
)
