"""Deal inputs and the underwriting orchestration that turns them into metrics.

This is the heart of EPIC 01: given a fully-specified deal it produces required
equity, stabilized NOI, DSCR, CoC, 5-year IRR, break-even occupancy, exit value
and real leverage — deterministically, in Decimal.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from decimal import Decimal
from typing import Optional

from ..calculators import metrics
from ..calculators.amortization import DebtSchedule, build_schedule
from ..calculators.cashflow import ProjectionInputs, ProjectionResult, project
from ..domain.loan import LoanQuote, RepaymentType
from ..domain.money import Money, Rate
from ..domain.operating import OperatingExpenses, OperatingStatement
from ..domain.rent_roll import RentRoll
from ..domain.sources_uses import Sources, SourcesAndUses, Uses
from ..version import ENGINE_VERSION


def _q(value: Optional[Decimal], places: str = "0.000001") -> Optional[str]:
    if value is None:
        return None
    return str(value.quantize(Decimal(places)))


@dataclass(frozen=True)
class FinancingSpec:
    """How the loan is sized against a purchase price.

    LTV is applied to ``collateral_value`` if given, otherwise to the purchase
    price. This keeps the loan a function of price so the max-price solver can
    sweep price and re-size debt.
    """

    ltv_target: Decimal
    rate: Rate
    term_months: int = 240
    amortization_months: Optional[int] = None
    grace_months: int = 0
    repayment_type: RepaymentType = RepaymentType.EQUAL_PAYMENT
    collateral_value: Optional[Money] = None

    def loan_for(self, purchase_price: Money) -> LoanQuote:
        basis = self.collateral_value or purchase_price
        principal = basis * self.ltv_target
        return LoanQuote(
            principal=principal,
            rate=self.rate,
            term_months=self.term_months,
            amortization_months=self.amortization_months,
            grace_months=self.grace_months,
            repayment_type=self.repayment_type,
        )


@dataclass(frozen=True)
class InvestmentTargets:
    """Hurdles the deal must clear (drive both decision and the price solver)."""

    target_irr: Decimal = Decimal("0.12")
    min_dscr: Decimal = Decimal("1.25")
    min_cash_on_cash: Decimal = Decimal("0.05")
    max_real_leverage: Decimal = Decimal("0.80")
    min_downside_dscr: Decimal = Decimal("1.00")


@dataclass(frozen=True)
class DealInputs:
    """Everything needed to underwrite one deal."""

    rent_roll: RentRoll
    opex: OperatingExpenses
    purchase_price: Money
    financing: FinancingSpec
    targets: InvestmentTargets = field(default_factory=InvestmentTargets)

    # operating assumptions
    vacancy_rate: Decimal = Decimal("0.05")
    stabilized_vacancy_rate: Optional[Decimal] = None
    other_income_annual: Money = field(default_factory=lambda: Money.zero())
    credit_loss_annual: Money = field(default_factory=lambda: Money.zero())

    # acquisition / uses
    acquisition_cost_rate: Decimal = Decimal("0.05")  # of purchase price
    capex: Money = field(default_factory=lambda: Money.zero())
    contingency_rate: Decimal = Decimal("0.10")       # of capex
    financing_costs: Money = field(default_factory=lambda: Money.zero())
    working_capital: Money = field(default_factory=lambda: Money.zero())
    assume_deposits: bool = True

    # projection / exit
    hold_years: int = 5
    rent_growth: Decimal = Decimal("0.02")
    opex_growth: Decimal = Decimal("0.02")
    exit_cap_rate: Decimal = Decimal("0.05")
    selling_cost_rate: Decimal = Decimal("0.02")
    discount_rate: Decimal = Decimal("0.08")
    revenue_loss_months_year1: int = 0

    @property
    def currency(self) -> str:
        return self.purchase_price.currency

    def assumed_deposits(self) -> Money:
        if self.assume_deposits:
            return self.rent_roll.total_deposits
        return Money.zero(self.currency)


@dataclass(frozen=True)
class UnderwriteResult:
    engine_version: str
    currency: str
    purchase_price: Money
    total_project_cost: Money
    loan_amount: Money
    assumed_deposits: Money
    required_equity: Money
    funding_gap: Money
    current_noi: Money
    stabilized_noi: Money
    annual_debt_service: Money
    pre_tax_cash_flow: Money
    exit_value: Money
    net_sale_proceeds: Money
    # ratios (Decimal or None)
    cap_rate: Optional[Decimal]
    ltv: Optional[Decimal]
    ltc: Optional[Decimal]
    dscr: Optional[Decimal]
    debt_yield: Optional[Decimal]
    cash_on_cash: Optional[Decimal]
    break_even_occupancy: Optional[Decimal]
    real_leverage: Decimal
    irr: Optional[Decimal]
    npv: Money
    equity_multiple: Optional[Decimal]
    projection: ProjectionResult
    debt_schedule: DebtSchedule

    def to_dict(self) -> dict:
        money = lambda m: int(m.rounded().amount)  # noqa: E731
        return {
            "engine_version": self.engine_version,
            "currency": self.currency,
            "purchase_price": money(self.purchase_price),
            "total_project_cost": money(self.total_project_cost),
            "loan_amount": money(self.loan_amount),
            "assumed_deposits": money(self.assumed_deposits),
            "required_equity": money(self.required_equity),
            "funding_gap": money(self.funding_gap),
            "current_noi": money(self.current_noi),
            "stabilized_noi": money(self.stabilized_noi),
            "annual_debt_service": money(self.annual_debt_service),
            "pre_tax_cash_flow": money(self.pre_tax_cash_flow),
            "exit_value": money(self.exit_value),
            "net_sale_proceeds": money(self.net_sale_proceeds),
            "cap_rate": _q(self.cap_rate),
            "ltv": _q(self.ltv),
            "ltc": _q(self.ltc),
            "dscr": _q(self.dscr),
            "debt_yield": _q(self.debt_yield),
            "cash_on_cash": _q(self.cash_on_cash),
            "break_even_occupancy": _q(self.break_even_occupancy),
            "real_leverage": _q(self.real_leverage),
            "irr": _q(self.irr),
            "npv": money(self.npv),
            "equity_multiple": _q(self.equity_multiple, "0.0001"),
        }


def underwrite(deal: DealInputs) -> UnderwriteResult:
    ccy = deal.currency
    rr = deal.rent_roll
    gpr_annual = rr.gpr_annual

    # --- operating statement -> NOI ------------------------------------------
    stmt = OperatingStatement(
        gpr_annual=gpr_annual,
        opex=deal.opex,
        vacancy_rate=deal.vacancy_rate,
        credit_loss=deal.credit_loss_annual,
        other_income=deal.other_income_annual,
        stabilized_vacancy_rate=deal.stabilized_vacancy_rate,
    )
    current_noi = stmt.noi()
    stabilized_noi = stmt.stabilized_noi()

    # --- financing -----------------------------------------------------------
    loan = deal.financing.loan_for(deal.purchase_price)
    schedule = build_schedule(loan)
    annual_ds = schedule.first_year_debt_service()

    # --- sources & uses ------------------------------------------------------
    acquisition_costs = deal.purchase_price * deal.acquisition_cost_rate
    contingency = deal.capex * deal.contingency_rate
    uses = Uses(
        purchase_price=deal.purchase_price,
        acquisition_costs=acquisition_costs,
        capex=deal.capex,
        contingency=contingency,
        financing_costs=deal.financing_costs,
        working_capital=deal.working_capital,
    )
    assumed_deposits = deal.assumed_deposits()
    sources = Sources(loan_amount=loan.principal, assumed_deposits=assumed_deposits)
    su = SourcesAndUses(uses=uses, sources=sources)
    total_cost = su.total_project_cost()
    required_equity = su.required_equity()
    funding_gap = su.funding_gap()

    # --- headline ratios (on stabilized NOI) ---------------------------------
    ptcf = metrics.pre_tax_cash_flow(stabilized_noi, annual_ds)
    result_cap = metrics.cap_rate(stabilized_noi, deal.purchase_price)
    result_ltv = metrics.ltv(loan.principal, deal.financing.collateral_value or deal.purchase_price)
    result_ltc = metrics.ltc(loan.principal, total_cost)
    result_dscr = metrics.dscr(stabilized_noi, annual_ds)
    result_dy = metrics.debt_yield(stabilized_noi, loan.principal)
    result_coc = metrics.cash_on_cash(ptcf, required_equity)
    result_beo = metrics.break_even_occupancy(
        stmt.opex_total(), annual_ds, deal.other_income_annual, gpr_annual
    )
    real_lev = su.real_leverage(deal.purchase_price)

    # --- projection ----------------------------------------------------------
    proj = project(
        ProjectionInputs(
            gpr_annual=gpr_annual,
            opex_annual=deal.opex.total(),
            initial_equity=required_equity,
            hold_years=deal.hold_years,
            vacancy_rate=(
                deal.stabilized_vacancy_rate
                if deal.stabilized_vacancy_rate is not None
                else deal.vacancy_rate
            ),
            rent_growth=deal.rent_growth,
            opex_growth=deal.opex_growth,
            other_income_annual=deal.other_income_annual,
            credit_loss_annual=deal.credit_loss_annual,
            exit_cap_rate=deal.exit_cap_rate,
            selling_cost_rate=deal.selling_cost_rate,
            discount_rate=deal.discount_rate,
            revenue_loss_months_year1=deal.revenue_loss_months_year1,
            debt_schedule=schedule,
        )
    )

    return UnderwriteResult(
        engine_version=ENGINE_VERSION,
        currency=ccy,
        purchase_price=deal.purchase_price,
        total_project_cost=total_cost,
        loan_amount=loan.principal,
        assumed_deposits=assumed_deposits,
        required_equity=required_equity,
        funding_gap=funding_gap,
        current_noi=current_noi,
        stabilized_noi=stabilized_noi,
        annual_debt_service=annual_ds,
        pre_tax_cash_flow=ptcf,
        exit_value=proj.exit_value,
        net_sale_proceeds=proj.net_sale_proceeds,
        cap_rate=result_cap,
        ltv=result_ltv,
        ltc=result_ltc,
        dscr=result_dscr,
        debt_yield=result_dy,
        cash_on_cash=result_coc,
        break_even_occupancy=result_beo,
        real_leverage=real_lev,
        irr=proj.irr,
        npv=Money(proj.npv, ccy),
        equity_multiple=proj.equity_multiple,
        projection=proj,
        debt_schedule=schedule,
    )


__all__ = [
    "FinancingSpec",
    "InvestmentTargets",
    "DealInputs",
    "UnderwriteResult",
    "underwrite",
]
