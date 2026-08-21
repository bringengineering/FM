"""Operating Statement — operating expenses and the NOI bridge.

NOI excludes debt service, depreciation, and income tax (CLAUDE.md rule 7.1).
Capital expenditure (CapEx) is tracked separately from OPEX and belongs to
Sources & Uses, not to NOI.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from decimal import Decimal
from typing import Optional

from .money import Money


@dataclass(frozen=True)
class OperatingExpenses:
    """Annual operating expenses, split fixed vs. variable.

    Variable expenses scale with occupancy in the cashflow projection; fixed
    ones do not. Reserve (정기교체 충당금) is an operating reserve, not CapEx.
    """

    property_management: Money = field(default_factory=lambda: Money.zero())
    cleaning: Money = field(default_factory=lambda: Money.zero())
    repairs: Money = field(default_factory=lambda: Money.zero())
    insurance: Money = field(default_factory=lambda: Money.zero())
    utilities_common: Money = field(default_factory=lambda: Money.zero())
    water: Money = field(default_factory=lambda: Money.zero())
    gas: Money = field(default_factory=lambda: Money.zero())
    telecom: Money = field(default_factory=lambda: Money.zero())
    staff: Money = field(default_factory=lambda: Money.zero())
    taxes_operating: Money = field(default_factory=lambda: Money.zero())  # 재산세 등
    marketing: Money = field(default_factory=lambda: Money.zero())
    reserve: Money = field(default_factory=lambda: Money.zero())
    other: Money = field(default_factory=lambda: Money.zero())
    currency: str = "KRW"

    _VARIABLE_FIELDS = (
        "utilities_common",
        "water",
        "gas",
        "telecom",
        "cleaning",
    )

    def total(self) -> Money:
        acc = Money.zero(self.currency)
        for name in (
            "property_management",
            "cleaning",
            "repairs",
            "insurance",
            "utilities_common",
            "water",
            "gas",
            "telecom",
            "staff",
            "taxes_operating",
            "marketing",
            "reserve",
            "other",
        ):
            acc += getattr(self, name)
        return acc

    def variable_total(self) -> Money:
        acc = Money.zero(self.currency)
        for name in self._VARIABLE_FIELDS:
            acc += getattr(self, name)
        return acc

    def fixed_total(self) -> Money:
        return self.total() - self.variable_total()


@dataclass(frozen=True)
class OperatingStatement:
    """Bridges Gross Potential Rent to NOI for a single (annual) period.

    - EGI  = GPR - vacancy loss - credit loss (arrears) + other income
    - NOI  = EGI - OPEX
    - stabilized NOI applies a stabilized (long-run) vacancy assumption instead
      of the current in-place vacancy.
    """

    gpr_annual: Money
    opex: OperatingExpenses
    vacancy_rate: Decimal = Decimal("0")
    credit_loss: Money = field(default_factory=lambda: Money.zero())
    other_income: Money = field(default_factory=lambda: Money.zero())
    stabilized_vacancy_rate: Optional[Decimal] = None

    def __post_init__(self) -> None:
        if not (Decimal(0) <= self.vacancy_rate <= Decimal(1)):
            raise ValueError("vacancy_rate must be within [0, 1]")
        if self.stabilized_vacancy_rate is not None and not (
            Decimal(0) <= self.stabilized_vacancy_rate <= Decimal(1)
        ):
            raise ValueError("stabilized_vacancy_rate must be within [0, 1]")

    @property
    def currency(self) -> str:
        return self.gpr_annual.currency

    def vacancy_loss(self) -> Money:
        return self.gpr_annual * self.vacancy_rate

    def egi(self) -> Money:
        return self.gpr_annual - self.vacancy_loss() - self.credit_loss + self.other_income

    def opex_total(self) -> Money:
        return self.opex.total()

    def noi(self) -> Money:
        return self.egi() - self.opex_total()

    def stabilized_noi(self) -> Money:
        rate = (
            self.stabilized_vacancy_rate
            if self.stabilized_vacancy_rate is not None
            else self.vacancy_rate
        )
        egi = self.gpr_annual - (self.gpr_annual * rate) - self.credit_loss + self.other_income
        return egi - self.opex_total()


__all__ = ["OperatingExpenses", "OperatingStatement"]
