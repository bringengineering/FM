"""Core ratio tests (docs/formulas.md)."""

from __future__ import annotations

from decimal import Decimal

from valuescope import Money
from valuescope.calculators import metrics


def test_cap_rate():
    assert metrics.cap_rate(Money.won(50_000_000), Money.won(1_000_000_000)) == Decimal("0.05")


def test_cap_rate_zero_price_none():
    assert metrics.cap_rate(Money.won(50_000_000), Money.zero()) is None


def test_ltv():
    assert metrics.ltv(Money.won(600_000_000), Money.won(1_000_000_000)) == Decimal("0.6")


def test_ltv_zero_value_none():
    assert metrics.ltv(Money.won(600_000_000), Money.zero()) is None


def test_ltc():
    assert metrics.ltc(Money.won(600_000_000), Money.won(1_200_000_000)) == Decimal("0.5")


def test_dscr():
    assert metrics.dscr(Money.won(50_000_000), Money.won(40_000_000)) == Decimal("1.25")


def test_dscr_no_debt_none():
    assert metrics.dscr(Money.won(50_000_000), Money.zero()) is None


def test_debt_yield():
    assert metrics.debt_yield(Money.won(60_000_000), Money.won(600_000_000)) == Decimal("0.1")


def test_debt_yield_no_loan_none():
    assert metrics.debt_yield(Money.won(60_000_000), Money.zero()) is None


def test_cash_on_cash():
    assert metrics.cash_on_cash(Money.won(20_000_000), Money.won(400_000_000)) == Decimal("0.05")


def test_cash_on_cash_zero_equity_none():
    assert metrics.cash_on_cash(Money.won(20_000_000), Money.zero()) is None


def test_break_even_occupancy():
    # (OPEX 20m + DS 30m - other 0) / GPR 60m = 0.8333...
    result = metrics.break_even_occupancy(
        Money.won(20_000_000), Money.won(30_000_000), Money.zero(), Money.won(60_000_000)
    )
    assert result == Decimal("50000000") / Decimal("60000000")


def test_break_even_with_other_income():
    result = metrics.break_even_occupancy(
        Money.won(20_000_000), Money.won(30_000_000), Money.won(10_000_000), Money.won(60_000_000)
    )
    assert result == Decimal("40000000") / Decimal("60000000")


def test_break_even_over_one_when_unaffordable():
    result = metrics.break_even_occupancy(
        Money.won(40_000_000), Money.won(40_000_000), Money.zero(), Money.won(60_000_000)
    )
    assert result > Decimal("1")


def test_pre_tax_cash_flow():
    assert metrics.pre_tax_cash_flow(Money.won(50_000_000), Money.won(30_000_000)) == Money.won(
        20_000_000
    )


def test_pre_tax_cash_flow_negative():
    assert metrics.pre_tax_cash_flow(Money.won(30_000_000), Money.won(50_000_000)).amount < 0
