"""Scenario engine tests."""

from __future__ import annotations

from decimal import Decimal

from valuescope.engine import run_scenarios, underwrite
from valuescope.engine.scenario import BASE, DOWNSIDE, UPSIDE, STATUS_QUO
from tests.conftest import make_deal


def test_four_default_scenarios_present():
    s = run_scenarios(make_deal())
    assert set(s.keys()) == {"status_quo", "base", "upside", "downside"}


def test_base_scenario_matches_direct_underwrite():
    deal = make_deal()
    direct = underwrite(deal)
    scen = run_scenarios(deal)["base"].result
    assert scen.stabilized_noi == direct.stabilized_noi
    assert scen.dscr == direct.dscr


def test_downside_rate_bump_increases_debt_service():
    deal = make_deal()
    base = run_scenarios(deal)["base"].result
    down = run_scenarios(deal)["downside"].result
    assert down.annual_debt_service > base.annual_debt_service


def test_downside_lowers_noi_via_rent_cut_and_vacancy():
    deal = make_deal()
    base = run_scenarios(deal)["base"].result
    down = run_scenarios(deal)["downside"].result
    assert down.stabilized_noi < base.stabilized_noi


def test_downside_worse_dscr_than_base():
    deal = make_deal()
    s = run_scenarios(deal)
    assert s["downside"].result.dscr < s["base"].result.dscr


def test_upside_better_irr_than_base():
    deal = make_deal()
    s = run_scenarios(deal)
    assert s["upside"].result.irr > s["base"].result.irr


def test_status_quo_zeroes_capex():
    deal = make_deal()
    sq = run_scenarios(deal)["status_quo"]
    assert sq.deal.capex.is_zero()


def test_scenario_does_not_mutate_base_deal():
    deal = make_deal()
    original_rent = deal.rent_roll.gpr_monthly
    run_scenarios(deal)
    assert deal.rent_roll.gpr_monthly == original_rent  # base unchanged


def test_downside_rent_multiplier_applied():
    deal = make_deal()
    down_deal = DOWNSIDE.apply(deal)
    # 10% rent cut
    assert down_deal.rent_roll.gpr_monthly == deal.rent_roll.gpr_monthly * Decimal("0.90")


def test_downside_construction_delay_capped_at_12():
    deal = make_deal(revenue_loss_months_year1=10)
    down_deal = DOWNSIDE.apply(deal)  # +6 -> would be 16, capped at 12
    assert down_deal.revenue_loss_months_year1 == 12
