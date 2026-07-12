"""Loan quote — a lender's terms, tagged with who quoted it and when.

CLAUDE.md rule 5/22: LTV, DSR and other regulatory values are NOT hardcoded.
Every quote stores the lender, borrower type, product and quote date so that a
deal's financing reflects a real, dated offer rather than a global constant.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Optional

from .money import Money, Rate


class BorrowerType(str, Enum):
    INDIVIDUAL = "individual"          # 개인
    SOLE_PROPRIETOR = "sole_proprietor"  # 개인사업자
    CORPORATION = "corporation"        # 법인


class RepaymentType(str, Enum):
    EQUAL_PAYMENT = "equal_payment"        # 원리금균등
    EQUAL_PRINCIPAL = "equal_principal"    # 원금균등
    INTEREST_ONLY = "interest_only"        # 만기일시 (이자만, 원금 만기상환)


@dataclass(frozen=True)
class LoanQuote:
    """A single dated financing offer."""

    principal: Money
    rate: Rate
    term_months: int
    repayment_type: RepaymentType = RepaymentType.EQUAL_PAYMENT
    amortization_months: Optional[int] = None  # for balloon: amort > term
    grace_months: int = 0                      # 거치기간 (interest-only prefix)
    lender: str = ""
    borrower_type: BorrowerType = BorrowerType.INDIVIDUAL
    product_type: str = ""
    fixed: bool = False
    fees: Money = field(default_factory=lambda: Money.zero())
    prepayment_penalty_rate: Rate = field(default_factory=lambda: Rate(0))
    quote_date: Optional[str] = None

    def __post_init__(self) -> None:
        if self.principal.amount < 0:
            raise ValueError("loan principal cannot be negative")
        if self.term_months <= 0:
            raise ValueError("term_months must be positive")
        if self.grace_months < 0 or self.grace_months >= self.term_months:
            raise ValueError("grace_months must be within [0, term_months)")
        amort = self.amortization_months or self.term_months
        if amort < self.term_months:
            raise ValueError("amortization_months cannot be shorter than term_months")

    @property
    def effective_amortization_months(self) -> int:
        return self.amortization_months or self.term_months


__all__ = ["LoanQuote", "BorrowerType", "RepaymentType"]
