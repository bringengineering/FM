"""Sources & Uses — total project cost and the equity actually required.

Critical rule (CLAUDE.md 7): an assumed tenant deposit reduces the cash equity
needed at closing, but it is a liability that must be returned. It appears as a
Source here AND is carried into the real-leverage metric as debt.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from .money import Money


@dataclass(frozen=True)
class Uses:
    """Where the money goes (총사업비 구성)."""

    purchase_price: Money
    acquisition_costs: Money = field(default_factory=lambda: Money.zero())  # 취득세·중개·법무 등
    capex: Money = field(default_factory=lambda: Money.zero())              # 공사비
    contingency: Money = field(default_factory=lambda: Money.zero())        # 예비비
    financing_costs: Money = field(default_factory=lambda: Money.zero())    # 취급·설정비, 공사중이자
    working_capital: Money = field(default_factory=lambda: Money.zero())    # 운전자금

    @property
    def currency(self) -> str:
        return self.purchase_price.currency

    def total(self) -> Money:
        return (
            self.purchase_price
            + self.acquisition_costs
            + self.capex
            + self.contingency
            + self.financing_costs
            + self.working_capital
        )


@dataclass(frozen=True)
class Sources:
    """Where the money comes from."""

    loan_amount: Money
    assumed_deposits: Money = field(default_factory=lambda: Money.zero())  # 승계 임차보증금
    grants: Money = field(default_factory=lambda: Money.zero())            # 지원금

    @property
    def currency(self) -> str:
        return self.loan_amount.currency

    def non_equity_total(self) -> Money:
        return self.loan_amount + self.assumed_deposits + self.grants


@dataclass(frozen=True)
class SourcesAndUses:
    uses: Uses
    sources: Sources

    def total_project_cost(self) -> Money:
        return self.uses.total()

    def required_equity(self) -> Money:
        """Cash the sponsor must bring: total uses minus all non-equity sources.

        Can be negative in theory (over-financed); callers treat a negative or
        zero here as a financing surplus, and a positive funding_gap as a
        shortfall that must be covered.
        """
        return self.uses.total() - self.sources.non_equity_total()

    def funding_gap(self) -> Money:
        """Positive when sources cannot cover uses even with full equity call.

        In this model required_equity is defined as the residual, so the gap is
        always zero unless a loan is capped below what the deal needs. Kept
        explicit so scenario code can inject a capped loan and surface a real
        shortfall.
        """
        gap = self.required_equity()
        return gap if gap.amount < 0 else Money.zero(self.uses.currency)

    def real_leverage(self, asset_value: Money) -> "Decimal":
        """(financial debt + deposit return obligation) / asset value.

        This is the number that turns a "50% LTV" deal into a 75% real-leverage
        deal once assumed deposits are counted (PRD 7.4).
        """
        from decimal import Decimal

        if asset_value.amount == 0:
            return Decimal(0)
        debt = self.sources.loan_amount + self.sources.assumed_deposits
        return debt.amount / asset_value.amount


__all__ = ["Uses", "Sources", "SourcesAndUses"]
