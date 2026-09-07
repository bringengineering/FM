"""Core underwriting ratios. Each formula is documented in docs/formulas.md.

Every function returns a Decimal ratio (not a percentage) so callers control
display. Division guards return None where the denominator is zero, because a
0-denominator ratio is undefined, not zero (e.g. Debt Yield with no loan).
"""

from __future__ import annotations

from decimal import Decimal
from typing import Optional

from ..domain.money import Money


def cap_rate(noi: Money, asset_price: Money) -> Optional[Decimal]:
    """NOI / asset price."""
    if asset_price.amount == 0:
        return None
    return noi.amount / asset_price.amount


def ltv(loan: Money, collateral_value: Money) -> Optional[Decimal]:
    """Loan / collateral value (담보가치 기준)."""
    if collateral_value.amount == 0:
        return None
    return loan.amount / collateral_value.amount


def ltc(loan: Money, total_cost: Money) -> Optional[Decimal]:
    """Loan / total project cost."""
    if total_cost.amount == 0:
        return None
    return loan.amount / total_cost.amount


def dscr(noi: Money, annual_debt_service: Money) -> Optional[Decimal]:
    """NOI / annual debt service. None when there is no debt service."""
    if annual_debt_service.amount == 0:
        return None
    return noi.amount / annual_debt_service.amount


def debt_yield(noi: Money, loan: Money) -> Optional[Decimal]:
    """NOI / loan — the lender's view of collateral safety."""
    if loan.amount == 0:
        return None
    return noi.amount / loan.amount


def cash_on_cash(pre_tax_cash_flow: Money, equity: Money) -> Optional[Decimal]:
    """Annual pre-tax cash flow / initial equity."""
    if equity.amount == 0:
        return None
    return pre_tax_cash_flow.amount / equity.amount


def break_even_occupancy(
    opex: Money, annual_debt_service: Money, other_income: Money, gpr_annual: Money
) -> Optional[Decimal]:
    """(OPEX + debt service - other income) / GPR.

    The minimum occupancy at which the property covers cash costs. A value > 1
    means the deal cannot break even even fully leased.
    """
    if gpr_annual.amount == 0:
        return None
    numerator = opex + annual_debt_service - other_income
    return numerator.amount / gpr_annual.amount


def pre_tax_cash_flow(noi: Money, annual_debt_service: Money) -> Money:
    """NOI - annual debt service (before tax, before CapEx)."""
    return noi - annual_debt_service


__all__ = [
    "cap_rate",
    "ltv",
    "ltc",
    "dscr",
    "debt_yield",
    "cash_on_cash",
    "break_even_occupancy",
    "pre_tax_cash_flow",
]
