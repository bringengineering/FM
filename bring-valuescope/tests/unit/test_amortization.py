"""Debt schedule tests for the three repayment conventions."""

from __future__ import annotations

from decimal import Decimal

import pytest

from valuescope import LoanQuote, Money, Rate, RepaymentType
from valuescope.calculators import build_schedule


def loan(**kw) -> LoanQuote:
    base = dict(
        principal=Money.won(100_000_000),
        rate=Rate.percent("6"),
        term_months=240,
        repayment_type=RepaymentType.EQUAL_PAYMENT,
    )
    base.update(kw)
    return LoanQuote(**base)


def test_equal_payment_amortizes_to_zero():
    sched = build_schedule(loan())
    assert abs(sched.rows[-1].balance.amount) < Decimal("1")  # <1원 residual


def test_equal_payment_principal_sums_to_original():
    sched = build_schedule(loan())
    total_principal = sum((r.principal.amount for r in sched.rows), Decimal(0))
    assert abs(total_principal - Decimal("100000000")) < Decimal("1")


def test_equal_payment_constant_payment():
    sched = build_schedule(loan())
    payments = {r.payment.amount for r in sched.rows}
    assert len(payments) == 1  # every month identical


def test_equal_payment_zero_rate():
    sched = build_schedule(loan(rate=Rate.percent("0"), term_months=100))
    # payment = principal / n, all principal, no interest
    assert sched.rows[0].payment == Money.won(1_000_000)
    assert sched.total_interest() == Money.zero()


def test_equal_principal_constant_principal_component():
    sched = build_schedule(loan(repayment_type=RepaymentType.EQUAL_PRINCIPAL, term_months=200))
    principals = {r.principal.amount for r in sched.rows}
    assert len(principals) == 1
    assert sched.rows[0].principal == Money.won(500_000)  # 100m / 200


def test_equal_principal_first_interest():
    sched = build_schedule(loan(repayment_type=RepaymentType.EQUAL_PRINCIPAL, term_months=200))
    # first month interest = 100m * 0.5% monthly = 500,000
    assert sched.rows[0].interest == Money.won(500_000)


def test_equal_principal_payment_decreases():
    sched = build_schedule(loan(repayment_type=RepaymentType.EQUAL_PRINCIPAL, term_months=200))
    assert sched.rows[0].payment > sched.rows[-1].payment


def test_interest_only_constant_balance_and_payment():
    sched = build_schedule(loan(repayment_type=RepaymentType.INTEREST_ONLY, term_months=24))
    assert all(r.balance == Money.won(100_000_000) for r in sched.rows)
    assert all(r.payment == Money.won(500_000) for r in sched.rows)  # 100m*0.5%
    assert sched.rows[0].principal == Money.zero()


def test_interest_only_balloon_balance_at_maturity():
    sched = build_schedule(loan(repayment_type=RepaymentType.INTEREST_ONLY, term_months=24))
    # principal repaid as balloon at maturity -> balance_at beyond term is 0
    assert sched.balance_at(24) == Money.won(100_000_000)
    assert sched.balance_at(25) == Money.zero()


def test_grace_period_interest_only_prefix():
    sched = build_schedule(loan(grace_months=12, term_months=240))
    for r in sched.rows[:12]:
        assert r.principal == Money.zero()
        assert r.payment == Money.won(500_000)  # interest only during grace
    # after grace, principal starts amortizing
    assert sched.rows[12].principal.amount > 0


def test_grace_period_still_amortizes_to_zero():
    sched = build_schedule(loan(grace_months=12, term_months=240))
    assert abs(sched.rows[-1].balance.amount) < Decimal("1")


def test_annual_debt_service_sums_twelve_months():
    # 120m over 120 months at 0% -> exactly 1,000,000/mo -> 12,000,000/yr
    sched = build_schedule(
        loan(principal=Money.won(120_000_000), rate=Rate.percent("0"), term_months=120)
    )
    assert sched.annual_debt_service(1) == Money.won(12_000_000)
    assert sched.annual_debt_service(2) == Money.won(12_000_000)


def test_first_year_debt_service_alias():
    sched = build_schedule(
        loan(principal=Money.won(120_000_000), rate=Rate.percent("0"), term_months=120)
    )
    assert sched.first_year_debt_service() == sched.annual_debt_service(1)


def test_total_interest_positive_for_interest_bearing_loan():
    sched = build_schedule(loan())
    assert sched.total_interest().amount > 0


def test_invalid_grace_rejected():
    with pytest.raises(ValueError):
        loan(grace_months=240, term_months=240)


def test_balloon_amortization_longer_than_term():
    # amort 360 but term 120 -> balloon balance remains at maturity
    sched = build_schedule(loan(term_months=120, amortization_months=360))
    assert sched.rows[-1].balance.amount > Decimal("0")
