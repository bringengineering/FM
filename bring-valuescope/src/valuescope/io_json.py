"""Build a DealInputs from a plain dict (JSON), and export analysis as dict/CSV.

Shared by the CLI and the API so that a deal analysed from a JSON file and one
analysed over HTTP produce byte-identical numbers (MVP: JSON and screen must
match). Amounts are integers in the minor unit (원); rates are strings/ints
parsed to Decimal. Floats are rejected, per the no-float rule.
"""

from __future__ import annotations

from decimal import Decimal
from typing import Any, Optional

from .domain.loan import RepaymentType
from .domain.money import Money, Rate
from .domain.operating import OperatingExpenses
from .domain.rent_roll import RentRoll, Unit
from .engine.decision import DataFlags
from .engine.underwrite import DealInputs, FinancingSpec, InvestmentTargets


def _dec(value: Any, field: str) -> Decimal:
    if isinstance(value, float):
        raise ValueError(f"{field}: float not allowed; use a string or integer")
    if isinstance(value, bool):
        raise ValueError(f"{field}: bool not allowed")
    return Decimal(str(value))


def _money(value: Any, field: str, ccy: str = "KRW") -> Money:
    if isinstance(value, float):
        raise ValueError(f"{field}: float not allowed for money; use an integer 원 amount")
    return Money(int(value) if isinstance(value, (int,)) else Decimal(str(value)), ccy)


def _opt_dec(d: dict, key: str) -> Optional[Decimal]:
    return _dec(d[key], key) if key in d and d[key] is not None else None


def deal_from_dict(payload: dict) -> tuple[DealInputs, DataFlags]:
    ccy = payload.get("currency", "KRW")

    units = tuple(
        Unit(
            unit_id=str(u["unit_id"]),
            area_m2=_dec(u.get("area_m2", 0), "area_m2"),
            deposit=_money(u.get("deposit", 0), "deposit", ccy),
            monthly_rent=_money(u["monthly_rent"], "monthly_rent", ccy),
            management_fee=_money(u.get("management_fee", 0), "management_fee", ccy),
            occupied=bool(u.get("occupied", True)),
            arrears=_money(u.get("arrears", 0), "arrears", ccy),
            market_rent=_money(u["market_rent"], "market_rent", ccy) if u.get("market_rent") is not None else None,
            target_rent=_money(u["target_rent"], "target_rent", ccy) if u.get("target_rent") is not None else None,
            lease_start=u.get("lease_start"),
            lease_end=u.get("lease_end"),
        )
        for u in payload["units"]
    )
    rent_roll = RentRoll(units=units, currency=ccy)

    o = payload.get("opex", {})
    opex = OperatingExpenses(
        property_management=_money(o.get("property_management", 0), "opex", ccy),
        cleaning=_money(o.get("cleaning", 0), "opex", ccy),
        repairs=_money(o.get("repairs", 0), "opex", ccy),
        insurance=_money(o.get("insurance", 0), "opex", ccy),
        utilities_common=_money(o.get("utilities_common", 0), "opex", ccy),
        water=_money(o.get("water", 0), "opex", ccy),
        gas=_money(o.get("gas", 0), "opex", ccy),
        telecom=_money(o.get("telecom", 0), "opex", ccy),
        staff=_money(o.get("staff", 0), "opex", ccy),
        taxes_operating=_money(o.get("taxes_operating", 0), "opex", ccy),
        marketing=_money(o.get("marketing", 0), "opex", ccy),
        reserve=_money(o.get("reserve", 0), "opex", ccy),
        other=_money(o.get("other", 0), "opex", ccy),
        currency=ccy,
    )

    f = payload["financing"]
    financing = FinancingSpec(
        ltv_target=_dec(f["ltv_target"], "ltv_target"),
        rate=Rate.percent(str(f["rate_percent"])),
        term_months=int(f.get("term_months", 240)),
        amortization_months=int(f["amortization_months"]) if f.get("amortization_months") else None,
        grace_months=int(f.get("grace_months", 0)),
        repayment_type=RepaymentType(f.get("repayment_type", "equal_payment")),
        collateral_value=_money(f["collateral_value"], "collateral_value", ccy) if f.get("collateral_value") else None,
    )

    t = payload.get("targets", {})
    targets = InvestmentTargets(
        target_irr=_dec(t.get("target_irr", "0.12"), "target_irr"),
        min_dscr=_dec(t.get("min_dscr", "1.25"), "min_dscr"),
        min_cash_on_cash=_dec(t.get("min_cash_on_cash", "0.05"), "min_cash_on_cash"),
        max_real_leverage=_dec(t.get("max_real_leverage", "0.80"), "max_real_leverage"),
        min_downside_dscr=_dec(t.get("min_downside_dscr", "1.00"), "min_downside_dscr"),
    )

    deal = DealInputs(
        rent_roll=rent_roll,
        opex=opex,
        purchase_price=_money(payload["purchase_price"], "purchase_price", ccy),
        financing=financing,
        targets=targets,
        vacancy_rate=_dec(payload.get("vacancy_rate", "0.05"), "vacancy_rate"),
        stabilized_vacancy_rate=_opt_dec(payload, "stabilized_vacancy_rate"),
        other_income_annual=_money(payload.get("other_income_annual", 0), "other_income_annual", ccy),
        credit_loss_annual=_money(payload.get("credit_loss_annual", 0), "credit_loss_annual", ccy),
        acquisition_cost_rate=_dec(payload.get("acquisition_cost_rate", "0.05"), "acquisition_cost_rate"),
        capex=_money(payload.get("capex", 0), "capex", ccy),
        contingency_rate=_dec(payload.get("contingency_rate", "0.10"), "contingency_rate"),
        financing_costs=_money(payload.get("financing_costs", 0), "financing_costs", ccy),
        working_capital=_money(payload.get("working_capital", 0), "working_capital", ccy),
        assume_deposits=bool(payload.get("assume_deposits", True)),
        hold_years=int(payload.get("hold_years", 5)),
        rent_growth=_dec(payload.get("rent_growth", "0.02"), "rent_growth"),
        opex_growth=_dec(payload.get("opex_growth", "0.02"), "opex_growth"),
        exit_cap_rate=_dec(payload.get("exit_cap_rate", "0.05"), "exit_cap_rate"),
        selling_cost_rate=_dec(payload.get("selling_cost_rate", "0.02"), "selling_cost_rate"),
        discount_rate=_dec(payload.get("discount_rate", "0.08"), "discount_rate"),
        revenue_loss_months_year1=int(payload.get("revenue_loss_months_year1", 0)),
    )

    df = payload.get("data", {})
    data = DataFlags(
        deposit_data_complete=bool(df.get("deposit_data_complete", True)),
        senior_lien_data_complete=bool(df.get("senior_lien_data_complete", True)),
        refinance_dependent=bool(df.get("refinance_dependent", False)),
    )
    return deal, data


def analysis_to_csv(analysis_dict: dict) -> str:
    """Flatten the base metrics of an analysis dict into a 2-column CSV."""
    lines = ["key,value"]
    base = analysis_dict["base"]
    for k, v in base.items():
        lines.append(f"{k},{v}")
    lines.append(f"walkaway_price,{analysis_dict['walkaway_price']}")
    lines.append(f"verdict,{analysis_dict['decision']['verdict']}")
    return "\n".join(lines)


__all__ = ["deal_from_dict", "analysis_to_csv"]
