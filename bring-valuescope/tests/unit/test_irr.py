"""IRR / NPV / Equity Multiple tests."""

from __future__ import annotations

from decimal import Decimal

from valuescope import Money
from valuescope.calculators import equity_multiple, irr, npv


def m(*amounts):
    return [Money.won(a) for a in amounts]


def test_npv_at_zero_rate_is_sum():
    assert npv(Decimal("0"), m(-100, 50, 80)) == Decimal("30")


def test_npv_discounts_future():
    # -100 + 110/1.1 = 0
    assert npv(Decimal("0.1"), m(-100, 110)) == Decimal("0")


def test_irr_simple_10_percent():
    r = irr(m(-100, 110))
    assert abs(r - Decimal("0.10")) < Decimal("0.000001")


def test_irr_five_year_10_percent():
    # 1000 grows to 1610.51 at 10% over 5y
    r = irr(m(-1000, 0, 0, 0, 0, 1610_51))  # scaled; ratio preserved
    # use precise: 1000 -> 1610.51 exactly at 10%
    r2 = irr([Money.won(-1000000), Money.won(0), Money.won(0), Money.won(0), Money.won(0), Money.won(1610510)])
    assert abs(r2 - Decimal("0.10")) < Decimal("0.00001")


def test_irr_no_sign_change_none():
    assert irr(m(100, 200, 300)) is None
    assert irr(m(-100, -200)) is None


def test_irr_negative_return():
    # -1000 then 900 -> IRR = -10%
    r = irr(m(-1000, 900))
    assert abs(r - Decimal("-0.10")) < Decimal("0.000001")


def test_equity_multiple():
    assert equity_multiple(m(-100, 50, 80)) == Decimal("130") / Decimal("100")


def test_equity_multiple_no_outflow_none():
    assert equity_multiple(m(100, 200)) is None


def test_npv_negative_when_rate_above_irr():
    # IRR is 10%; at 20% NPV should be negative
    assert npv(Decimal("0.2"), m(-100, 110)) < Decimal("0")
