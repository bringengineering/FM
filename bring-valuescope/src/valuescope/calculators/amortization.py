"""Debt service schedules for the three Korean repayment conventions.

All math is in Decimal. Monthly rate = annual / 12 (nominal, no intra-year
compounding), which is the convention Korean lenders quote.
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal
from typing import List

from ..domain.loan import LoanQuote, RepaymentType
from ..domain.money import Money


@dataclass(frozen=True)
class PaymentRow:
    month: int
    payment: Money
    interest: Money
    principal: Money
    balance: Money  # remaining balance AFTER this month's payment


@dataclass(frozen=True)
class DebtSchedule:
    rows: tuple[PaymentRow, ...]
    currency: str

    def annual_debt_service(self, year: int = 1) -> Money:
        """Sum of payments for the given 12-month window (year 1 = months 1..12)."""
        start = (year - 1) * 12 + 1
        end = year * 12
        acc = Money.zero(self.currency)
        for r in self.rows:
            if start <= r.month <= end:
                acc += r.payment
        return acc

    def total_interest(self) -> Money:
        acc = Money.zero(self.currency)
        for r in self.rows:
            acc += r.interest
        return acc

    def balance_at(self, month: int) -> Money:
        if month <= 0:
            return self.rows[0].balance + self.rows[0].principal
        for r in self.rows:
            if r.month == month:
                return r.balance
        # month beyond schedule -> fully repaid
        return Money.zero(self.currency)

    def first_year_debt_service(self) -> Money:
        return self.annual_debt_service(1)


def _equal_payment(principal: Decimal, monthly_rate: Decimal, n: int) -> Decimal:
    """원리금균등: constant payment amortizing ``principal`` over ``n`` months."""
    if monthly_rate == 0:
        return principal / Decimal(n)
    factor = (Decimal(1) + monthly_rate) ** n
    return principal * (monthly_rate * factor) / (factor - Decimal(1))


def build_schedule(loan: LoanQuote) -> DebtSchedule:
    """Build the month-by-month schedule for a loan.

    Handles a grace (거치) period as interest-only, then amortizes the remaining
    principal over the rest of the amortization window. For balloon loans
    (amortization_months > term_months) the schedule is truncated at term_months
    and the outstanding balance is the balloon due at maturity.
    """
    currency = loan.principal.currency
    balance = loan.principal.amount
    r = loan.rate.monthly
    term = loan.term_months
    amort = loan.effective_amortization_months
    grace = loan.grace_months

    rows: List[PaymentRow] = []

    def emit(month: int, payment: Decimal, interest: Decimal, principal_paid: Decimal, bal: Decimal) -> None:
        rows.append(
            PaymentRow(
                month=month,
                payment=Money(payment, currency),
                interest=Money(interest, currency),
                principal=Money(principal_paid, currency),
                balance=Money(bal, currency),
            )
        )

    if loan.repayment_type == RepaymentType.INTEREST_ONLY:
        for m in range(1, term + 1):
            interest = balance * r
            emit(m, interest, interest, Decimal(0), balance)
        # principal repaid as balloon at maturity (reflected in balance_at)
        return DebtSchedule(tuple(rows), currency)

    # Grace period: interest-only prefix (applies to both equal_* types)
    for m in range(1, grace + 1):
        interest = balance * r
        emit(m, interest, interest, Decimal(0), balance)

    remaining_amort = amort - grace  # months over which principal amortizes

    if loan.repayment_type == RepaymentType.EQUAL_PAYMENT:
        payment = _equal_payment(balance, r, remaining_amort)
        for m in range(grace + 1, term + 1):
            interest = balance * r
            principal_paid = payment - interest
            balance = balance - principal_paid
            emit(m, payment, interest, principal_paid, balance)
    elif loan.repayment_type == RepaymentType.EQUAL_PRINCIPAL:
        principal_component = balance / Decimal(remaining_amort)
        for m in range(grace + 1, term + 1):
            interest = balance * r
            payment = principal_component + interest
            balance = balance - principal_component
            emit(m, payment, interest, principal_component, balance)
    else:  # pragma: no cover - guarded by enum
        raise ValueError(f"unsupported repayment_type: {loan.repayment_type}")

    return DebtSchedule(tuple(rows), currency)


__all__ = ["PaymentRow", "DebtSchedule", "build_schedule"]
