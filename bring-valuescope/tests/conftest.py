"""Shared test fixtures and deal builders."""

from __future__ import annotations

from decimal import Decimal

import pytest

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


def make_rent_roll(
    n: int = 10,
    rent: int = 600_000,
    deposit: int = 10_000_000,
    occupied: int | None = None,
) -> RentRoll:
    occ = n if occupied is None else occupied
    units = tuple(
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
    return RentRoll(units=units)


def make_opex(total_hint: int = 12_000_000) -> OperatingExpenses:
    # split across a few lines; exact split doesn't matter for total-based tests
    return OperatingExpenses(
        property_management=Money.won(total_hint // 4),
        repairs=Money.won(total_hint // 4),
        insurance=Money.won(total_hint // 4),
        utilities_common=Money.won(total_hint - 3 * (total_hint // 4)),
    )


def make_deal(**overrides) -> DealInputs:
    base = dict(
        rent_roll=make_rent_roll(n=12, rent=650_000),
        opex=make_opex(10_200_000),
        purchase_price=Money.won(1_100_000_000),
        financing=FinancingSpec(
            ltv_target=Decimal("0.6"),
            rate=Rate.percent("4.5"),
            term_months=240,
        ),
        vacancy_rate=Decimal("0.05"),
        stabilized_vacancy_rate=Decimal("0.05"),
        capex=Money.won(60_000_000),
        exit_cap_rate=Decimal("0.048"),
        targets=InvestmentTargets(
            target_irr=Decimal("0.12"),
            min_dscr=Decimal("1.25"),
            min_cash_on_cash=Decimal("0.04"),
            max_real_leverage=Decimal("0.80"),
        ),
    )
    base.update(overrides)
    return DealInputs(**base)


@pytest.fixture
def good_deal() -> DealInputs:
    return make_deal()
