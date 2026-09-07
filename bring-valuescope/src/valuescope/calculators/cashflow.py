"""Multi-year (default 5) levered cash-flow projection and exit.

Deterministic annual model:
    GPR_y   = GPR1 * (1 + rent_growth)^(y-1)
    EGI_y   = GPR_y * (1 - vacancy) * revenue_factor_y - credit_loss + other_income
    OPEX_y  = OPEX1 * (1 + opex_growth)^(y-1)
    NOI_y   = EGI_y - OPEX_y
    CF_y    = NOI_y - debt_service_y      (levered, pre-tax)
Exit at year N uses a forward (year N+1) stabilized NOI capitalized at the exit
cap rate, less selling costs and the outstanding loan balance.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from decimal import Decimal
from typing import List, Optional

from ..domain.money import Money
from .amortization import DebtSchedule
from .irr import equity_multiple, irr, npv


@dataclass(frozen=True)
class ProjectionInputs:
    gpr_annual: Money            # year-1 gross potential rent at 100% occupancy
    opex_annual: Money           # year-1 operating expenses
    initial_equity: Money
    hold_years: int = 5
    vacancy_rate: Decimal = Decimal("0.05")
    rent_growth: Decimal = Decimal("0.02")
    opex_growth: Decimal = Decimal("0.02")
    other_income_annual: Money = field(default_factory=lambda: Money.zero())
    credit_loss_annual: Money = field(default_factory=lambda: Money.zero())
    exit_cap_rate: Decimal = Decimal("0.05")
    selling_cost_rate: Decimal = Decimal("0.02")
    discount_rate: Decimal = Decimal("0.08")   # for NPV
    revenue_loss_months_year1: int = 0          # construction / lease-up lost months
    debt_schedule: Optional[DebtSchedule] = None

    def __post_init__(self) -> None:
        if self.hold_years <= 0:
            raise ValueError("hold_years must be positive")
        if self.exit_cap_rate <= 0:
            raise ValueError("exit_cap_rate must be positive")
        if not (0 <= self.revenue_loss_months_year1 <= 12):
            raise ValueError("revenue_loss_months_year1 must be within [0, 12]")


@dataclass(frozen=True)
class YearRow:
    year: int
    gpr: Money
    egi: Money
    opex: Money
    noi: Money
    debt_service: Money
    cash_flow: Money  # levered, pre-tax, excludes sale proceeds


@dataclass(frozen=True)
class ProjectionResult:
    rows: tuple[YearRow, ...]
    equity_cash_flows: tuple[Money, ...]  # t0 outflow .. tN inflow incl. sale
    exit_value: Money
    net_sale_proceeds: Money
    irr: Optional[Decimal]
    npv: Decimal
    equity_multiple: Optional[Decimal]

    def year(self, y: int) -> YearRow:
        return self.rows[y - 1]


def _grow(base: Money, rate: Decimal, periods: int) -> Money:
    return base * ((Decimal(1) + rate) ** periods)


def project(inp: ProjectionInputs) -> ProjectionResult:
    ccy = inp.gpr_annual.currency
    rows: List[YearRow] = []

    def noi_for(year_index: int, revenue_factor: Decimal) -> tuple[Money, Money, Money, Money]:
        gpr = _grow(inp.gpr_annual, inp.rent_growth, year_index - 1)
        effective = gpr * (Decimal(1) - inp.vacancy_rate) * revenue_factor
        egi = effective - inp.credit_loss_annual + inp.other_income_annual
        opex = _grow(inp.opex_annual, inp.opex_growth, year_index - 1)
        noi = egi - opex
        return gpr, egi, opex, noi

    for y in range(1, inp.hold_years + 1):
        if y == 1 and inp.revenue_loss_months_year1 > 0:
            factor = Decimal(12 - inp.revenue_loss_months_year1) / Decimal(12)
        else:
            factor = Decimal(1)
        gpr, egi, opex, noi = noi_for(y, factor)
        ds = (
            inp.debt_schedule.annual_debt_service(y)
            if inp.debt_schedule is not None
            else Money.zero(ccy)
        )
        rows.append(YearRow(y, gpr, egi, opex, noi, ds, noi - ds))

    # Exit: forward (year N+1) stabilized NOI, no construction loss.
    _, _, _, exit_noi = noi_for(inp.hold_years + 1, Decimal(1))
    exit_value = exit_noi / inp.exit_cap_rate
    selling_costs = exit_value * inp.selling_cost_rate
    loan_balance = (
        inp.debt_schedule.balance_at(inp.hold_years * 12)
        if inp.debt_schedule is not None
        else Money.zero(ccy)
    )
    net_sale = exit_value - selling_costs - loan_balance

    equity_cfs: List[Money] = [-inp.initial_equity]
    for row in rows:
        cf = row.cash_flow
        if row.year == inp.hold_years:
            cf = cf + net_sale
        equity_cfs.append(cf)

    return ProjectionResult(
        rows=tuple(rows),
        equity_cash_flows=tuple(equity_cfs),
        exit_value=exit_value,
        net_sale_proceeds=net_sale,
        irr=irr(equity_cfs),
        npv=npv(inp.discount_rate, equity_cfs),
        equity_multiple=equity_multiple(equity_cfs),
    )


__all__ = ["ProjectionInputs", "YearRow", "ProjectionResult", "project"]
