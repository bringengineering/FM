"""Export a full analysis (base + scenarios + 5yr cashflow + sources/uses) as JSON
for the dashboard visualization."""

from __future__ import annotations

import json
import sys
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from valuescope.engine.analyze import analyze  # noqa: E402
from valuescope.io_json import deal_from_dict  # noqa: E402


def won(m):
    return int(m.rounded().amount)


def q(d, places="0.000001"):
    return None if d is None else float(Decimal(d).quantize(Decimal(places)))


def scen_summary(res):
    return {
        "stabilized_noi": won(res.stabilized_noi),
        "required_equity": won(res.required_equity),
        "annual_debt_service": won(res.annual_debt_service),
        "dscr": q(res.dscr, "0.001"),
        "cash_on_cash": q(res.cash_on_cash, "0.0001"),
        "irr": q(res.irr, "0.0001"),
        "exit_value": won(res.exit_value),
        "net_sale_proceeds": won(res.net_sale_proceeds),
        "real_leverage": q(res.real_leverage, "0.001"),
        "break_even_occupancy": q(res.break_even_occupancy, "0.0001"),
    }


def main(path):
    payload = json.loads(Path(path).read_text(encoding="utf-8"))
    deal, data = deal_from_dict(payload)
    a = analyze(deal, data=data)
    b = a.base

    proj = b.projection
    years = [
        {
            "year": r.year,
            "gpr": won(r.gpr),
            "egi": won(r.egi),
            "opex": won(r.opex),
            "noi": won(r.noi),
            "debt_service": won(r.debt_service),
            "cash_flow": won(r.cash_flow),
        }
        for r in proj.rows
    ]

    out = {
        "engine_version": b.engine_version,
        "asking_price": won(deal.purchase_price),
        "recommended_price": won(a.decision.recommended_price) if a.decision.recommended_price else None,
        "walkaway_price": won(a.solver.walkaway_price) if a.solver.walkaway_price else None,
        "verdict": a.decision.verdict.value,
        "hard_stops": list(a.decision.hard_stops),
        "conditions": list(a.decision.conditions),
        "top_risks": list(a.decision.top_risks),
        "headline": {
            "required_equity": won(b.required_equity),
            "total_project_cost": won(b.total_project_cost),
            "loan_amount": won(b.loan_amount),
            "assumed_deposits": won(b.assumed_deposits),
            "current_noi": won(b.current_noi),
            "stabilized_noi": won(b.stabilized_noi),
            "annual_debt_service": won(b.annual_debt_service),
            "pre_tax_cash_flow": won(b.pre_tax_cash_flow),
            "exit_value": won(b.exit_value),
            "net_sale_proceeds": won(b.net_sale_proceeds),
            "cap_rate": q(b.cap_rate, "0.0001"),
            "ltv": q(b.ltv, "0.0001"),
            "ltc": q(b.ltc, "0.0001"),
            "dscr": q(b.dscr, "0.001"),
            "debt_yield": q(b.debt_yield, "0.0001"),
            "cash_on_cash": q(b.cash_on_cash, "0.0001"),
            "break_even_occupancy": q(b.break_even_occupancy, "0.0001"),
            "real_leverage": q(b.real_leverage, "0.001"),
            "irr": q(b.irr, "0.0001"),
            "equity_multiple": q(b.equity_multiple, "0.001"),
            "npv": won(b.npv),
        },
        "sources_uses": {
            "uses": {
                "purchase_price": won(deal.purchase_price),
                "acquisition_costs": won(deal.purchase_price * deal.acquisition_cost_rate),
                "capex": won(deal.capex),
                "contingency": won(deal.capex * deal.contingency_rate),
            },
            "sources": {
                "loan": won(b.loan_amount),
                "assumed_deposits": won(b.assumed_deposits),
                "equity": won(b.required_equity),
            },
        },
        "scenarios": {name: scen_summary(sr.result) for name, sr in a.scenarios.items()},
        "cashflow_years": years,
        "targets": {
            "target_irr": q(deal.targets.target_irr, "0.0001"),
            "min_dscr": q(deal.targets.min_dscr, "0.001"),
            "min_cash_on_cash": q(deal.targets.min_cash_on_cash, "0.0001"),
            "max_real_leverage": q(deal.targets.max_real_leverage, "0.001"),
            "min_downside_dscr": q(deal.targets.min_downside_dscr, "0.001"),
        },
        "property": {
            "unit_count": deal.rent_roll.unit_count,
            "gpr_annual": won(deal.rent_roll.gpr_annual),
            "total_deposits": won(deal.rent_roll.total_deposits),
        },
    }
    print(json.dumps(out, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "examples/sample_deal.json")
