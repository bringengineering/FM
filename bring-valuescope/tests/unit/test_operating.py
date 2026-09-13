"""Operating Statement / NOI bridge tests."""

from __future__ import annotations

from decimal import Decimal

import pytest

from valuescope import Money
from valuescope.domain import OperatingExpenses, OperatingStatement


def make_stmt(**kw) -> OperatingStatement:
    base = dict(
        gpr_annual=Money.won(60_000_000),
        opex=OperatingExpenses(property_management=Money.won(12_000_000)),
        vacancy_rate=Decimal("0.05"),
    )
    base.update(kw)
    return OperatingStatement(**base)


def test_opex_total_sums_all_lines():
    opex = OperatingExpenses(
        property_management=Money.won(1_000_000),
        cleaning=Money.won(500_000),
        repairs=Money.won(500_000),
        insurance=Money.won(1_000_000),
    )
    assert opex.total() == Money.won(3_000_000)


def test_opex_variable_and_fixed_split():
    opex = OperatingExpenses(
        property_management=Money.won(1_000_000),  # fixed
        utilities_common=Money.won(600_000),        # variable
        water=Money.won(400_000),                    # variable
    )
    assert opex.variable_total() == Money.won(1_000_000)
    assert opex.fixed_total() == Money.won(1_000_000)


def test_vacancy_loss():
    stmt = make_stmt(vacancy_rate=Decimal("0.10"))
    assert stmt.vacancy_loss() == Money.won(6_000_000)


def test_egi():
    stmt = make_stmt(vacancy_rate=Decimal("0.05"))
    # 60,000,000 - 3,000,000 vacancy - 0 credit + 0 other
    assert stmt.egi() == Money.won(57_000_000)


def test_egi_with_credit_loss_and_other_income():
    stmt = make_stmt(
        vacancy_rate=Decimal("0.05"),
        credit_loss=Money.won(1_000_000),
        other_income=Money.won(2_000_000),
    )
    assert stmt.egi() == Money.won(58_000_000)


def test_noi_excludes_debt_and_tax():
    stmt = make_stmt()
    # EGI 57,000,000 - OPEX 12,000,000
    assert stmt.noi() == Money.won(45_000_000)


def test_stabilized_noi_uses_stabilized_vacancy():
    stmt = make_stmt(vacancy_rate=Decimal("0.20"), stabilized_vacancy_rate=Decimal("0.05"))
    # stabilized EGI = 60m*0.95 = 57m; NOI = 57m - 12m = 45m
    assert stmt.stabilized_noi() == Money.won(45_000_000)
    # current NOI uses 20% vacancy: EGI 48m; NOI 36m
    assert stmt.noi() == Money.won(36_000_000)


def test_stabilized_defaults_to_current_when_unset():
    stmt = make_stmt(vacancy_rate=Decimal("0.05"))
    assert stmt.stabilized_noi() == stmt.noi()


def test_zero_vacancy_boundary():
    stmt = make_stmt(vacancy_rate=Decimal("0"))
    assert stmt.egi() == Money.won(60_000_000)


def test_full_vacancy_boundary():
    stmt = make_stmt(vacancy_rate=Decimal("1"))
    assert stmt.egi() == Money.zero()
    assert stmt.noi() == Money.won(-12_000_000)


def test_invalid_vacancy_rejected():
    with pytest.raises(ValueError):
        make_stmt(vacancy_rate=Decimal("1.5"))
    with pytest.raises(ValueError):
        make_stmt(vacancy_rate=Decimal("-0.1"))
