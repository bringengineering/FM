"""Money / Rate / Period value-type tests."""

from __future__ import annotations

from decimal import Decimal

import pytest

from valuescope import Money, Period, Rate


def test_no_float_amount_allowed():
    with pytest.raises(TypeError):
        Money(1000.5)


def test_no_float_in_rate_percent():
    with pytest.raises(TypeError):
        Rate.percent(4.5)


def test_bool_rejected_as_amount():
    with pytest.raises(TypeError):
        Money(True)


def test_int_str_decimal_all_accepted():
    assert Money(1000).amount == Decimal(1000)
    assert Money("1000").amount == Decimal(1000)
    assert Money(Decimal("1000")).amount == Decimal(1000)


def test_addition_and_subtraction_exact():
    assert (Money.won(1000) + Money.won(2000)).amount == Decimal(3000)
    assert (Money.won(3000) - Money.won(1000)).amount == Decimal(2000)


def test_negative_and_zero_and_extreme():
    assert Money.zero().is_zero()
    assert (-Money.won(500)).amount == Decimal(-500)
    big = Money.won(10 ** 15) * Decimal("1.5")
    assert big.amount == Decimal("1500000000000000")


def test_currency_mismatch_raises():
    with pytest.raises(ValueError):
        Money(1000, "KRW") + Money(1000, "USD")


def test_multiplication_by_ratio_and_rmul():
    assert (Money.won(1000) * Decimal("0.6")).amount == Decimal("600")
    assert (Decimal("2") * Money.won(1000)).amount == Decimal("2000")


def test_money_divided_by_money_returns_ratio():
    ratio = Money.won(600) / Money.won(1000)
    assert ratio == Decimal("0.6")


def test_money_divided_by_scalar_returns_money():
    assert (Money.won(1000) / Decimal("4")).amount == Decimal("250")


def test_division_by_zero_raises():
    with pytest.raises(ZeroDivisionError):
        Money.won(1000) / Decimal("0")
    with pytest.raises(ZeroDivisionError):
        Money.won(1000) / Money.zero()


def test_krw_rounds_to_whole_won_half_up():
    assert Money(Decimal("1000.5")).rounded().amount == Decimal("1001")
    assert Money(Decimal("1000.4")).rounded().amount == Decimal("1000")


def test_usd_rounds_to_cents():
    assert Money(Decimal("10.005"), "USD").rounded().amount == Decimal("10.01")


def test_one_won_reproducibility():
    # summing 1원 a million times must be exact (no float drift)
    total = Money.zero()
    for _ in range(1_000_000):
        total += Money.won(1)
    assert total.amount == Decimal(1_000_000)


def test_comparisons():
    assert Money.won(100) < Money.won(200)
    assert Money.won(200) >= Money.won(200)
    assert Money.won(100) != Money.won(200)
    assert Money.won(100) == Money.won(100)


def test_rate_percent_and_bps_and_monthly():
    assert Rate.percent("6").value == Decimal("0.06")
    assert Rate.bps("650").value == Decimal("0.065")
    assert Rate.percent("6").monthly == Decimal("0.06") / Decimal(12)
    assert Rate.percent("6").as_percent == Decimal("6")


def test_rate_add_sub():
    assert (Rate.percent("4") + Rate.percent("2")).value == Decimal("0.06")
    assert (Rate.percent("4") - Rate.percent("1")).value == Decimal("0.03")


def test_period_years_and_validation():
    assert Period.years(5).months == 60
    assert Period(24).as_years == Decimal(2)
    with pytest.raises(ValueError):
        Period(-1)


def test_money_str_krw_format():
    assert str(Money.won(1_234_567)) == "1,234,567원"
