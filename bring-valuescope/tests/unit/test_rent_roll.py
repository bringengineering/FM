"""Rent Roll aggregate tests."""

from __future__ import annotations

from decimal import Decimal

import pytest

from valuescope import Money, RentRoll, Unit
from tests.conftest import make_rent_roll


def test_gpr_monthly_and_annual():
    rr = make_rent_roll(n=10, rent=500_000)
    assert rr.gpr_monthly == Money.won(5_000_000)
    assert rr.gpr_annual == Money.won(60_000_000)


def test_total_deposits():
    rr = make_rent_roll(n=10, deposit=10_000_000)
    assert rr.total_deposits == Money.won(100_000_000)


def test_unit_count():
    assert make_rent_roll(n=7).unit_count == 7


def test_physical_occupancy():
    rr = make_rent_roll(n=10, occupied=8)
    assert rr.physical_occupancy == Decimal("0.8")


def test_economic_occupancy_equal_rents():
    rr = make_rent_roll(n=10, rent=500_000, occupied=8)
    assert rr.economic_occupancy == Decimal("0.8")


def test_economic_occupancy_unequal_rents():
    units = (
        Unit("a", Decimal("20"), Money.zero(), Money.won(1_000_000), occupied=True),
        Unit("b", Decimal("20"), Money.zero(), Money.won(1_000_000), occupied=False),
        Unit("c", Decimal("20"), Money.zero(), Money.won(2_000_000), occupied=True),
    )
    rr = RentRoll(units=units)
    # occupied rent = 3,000,000 of GPR 4,000,000
    assert rr.economic_occupancy == Decimal("0.75")


def test_rent_gap_to_market():
    rr = make_rent_roll(n=10, rent=500_000)  # market_rent = 550,000
    # gap per unit = 50,000 * 12 = 600,000; x10 = 6,000,000
    assert rr.rent_gap_to_market() == Money.won(6_000_000)


def test_empty_rent_roll_rejected():
    with pytest.raises(ValueError):
        RentRoll(units=())


def test_duplicate_unit_id_rejected():
    units = (
        Unit("x", Decimal("20"), Money.zero(), Money.won(500_000)),
        Unit("x", Decimal("20"), Money.zero(), Money.won(500_000)),
    )
    with pytest.raises(ValueError):
        RentRoll(units=units)


def test_negative_rent_rejected():
    with pytest.raises(ValueError):
        Unit("x", Decimal("20"), Money.zero(), Money.won(-1))


def test_unit_annual_rent():
    u = Unit("x", Decimal("20"), Money.zero(), Money.won(500_000))
    assert u.annual_rent == Money.won(6_000_000)


def test_total_arrears():
    units = (
        Unit("a", Decimal("20"), Money.zero(), Money.won(500_000), arrears=Money.won(500_000)),
        Unit("b", Decimal("20"), Money.zero(), Money.won(500_000), arrears=Money.won(300_000)),
    )
    rr = RentRoll(units=units)
    assert rr.total_arrears == Money.won(800_000)
