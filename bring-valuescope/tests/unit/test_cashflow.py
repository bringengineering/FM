"""Multi-year projection + exit tests (hand-verifiable simple cases)."""

from __future__ import annotations

from decimal import Decimal

from valuescope import Money
from valuescope.calculators import build_schedule, project
from valuescope.calculators.cashflow import ProjectionInputs
from valuescope import LoanQuote, Rate


def simple(**kw) -> ProjectionInputs:
    base = dict(
        gpr_annual=Money.won(60_000_000),
        opex_annual=Money.won(20_000_000),
        initial_equity=Money.won(500_000_000),
        hold_years=5,
        vacancy_rate=Decimal("0"),
        rent_growth=Decimal("0"),
        opex_growth=Decimal("0"),
        exit_cap_rate=Decimal("0.05"),
        selling_cost_rate=Decimal("0"),
    )
    base.update(kw)
    return ProjectionInputs(**base)


def test_flat_noi_each_year():
    r = project(simple())
    for row in r.rows:
        assert row.noi == Money.won(40_000_000)


def test_exit_value_forward_noi_over_cap():
    r = project(simple())
    # forward NOI 40m / 5% = 800m
    assert r.exit_value == Money.won(800_000_000)


def test_net_sale_no_debt_no_selling_cost():
    r = project(simple())
    assert r.net_sale_proceeds == Money.won(800_000_000)


def test_equity_multiple_hand_check():
    r = project(simple())
    # inflows = 40m*5 + 800m = 1000m; outflow 500m -> 2.0
    assert r.equity_multiple == Decimal("2")


def test_vacancy_reduces_noi():
    r = project(simple(vacancy_rate=Decimal("0.10")))
    # egi = 60m*0.9 = 54m; noi = 34m
    assert r.rows[0].noi == Money.won(34_000_000)


def test_revenue_loss_year1_only():
    r = project(simple(revenue_loss_months_year1=6))
    # year1 factor 0.5 -> egi 30m, noi 10m; year2 back to 40m
    assert r.rows[0].noi == Money.won(10_000_000)
    assert r.rows[1].noi == Money.won(40_000_000)


def test_rent_growth_compounds():
    r = project(simple(rent_growth=Decimal("0.02")))
    assert r.rows[1].gpr == Money.won(60_000_000) * Decimal("1.02")


def test_opex_growth_compounds():
    r = project(simple(opex_growth=Decimal("0.03")))
    assert r.rows[1].opex == Money.won(20_000_000) * Decimal("1.03")


def test_selling_cost_reduces_net_sale():
    r = project(simple(selling_cost_rate=Decimal("0.02")))
    # 800m - 2% = 784m
    assert r.net_sale_proceeds == Money.won(784_000_000)


def test_debt_reduces_cash_flow_and_net_sale():
    ln = LoanQuote(principal=Money.won(600_000_000), rate=Rate.percent("5"), term_months=240)
    sched = build_schedule(ln)
    r = project(simple(debt_schedule=sched))
    ds = sched.annual_debt_service(1)
    assert r.rows[0].cash_flow == Money.won(40_000_000) - ds
    # net sale reduced by outstanding loan balance at year 5
    assert r.net_sale_proceeds.amount < Decimal("800000000")


def test_invalid_exit_cap_rejected():
    import pytest

    with pytest.raises(ValueError):
        simple(exit_cap_rate=Decimal("0"))


def test_invalid_revenue_loss_rejected():
    import pytest

    with pytest.raises(ValueError):
        simple(revenue_loss_months_year1=13)
