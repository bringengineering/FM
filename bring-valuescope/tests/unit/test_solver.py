"""Max purchase price (walk-away) solver tests."""

from __future__ import annotations

from dataclasses import replace
from decimal import Decimal

from valuescope import Money
from valuescope.engine import solve_max_price, underwrite
from tests.conftest import make_deal


def test_good_deal_has_walkaway():
    r = solve_max_price(make_deal())
    assert r.feasible
    assert r.walkaway_price.amount > 0


def test_walkaway_within_search_bounds():
    deal = make_deal()
    r = solve_max_price(deal)
    assert Money.won(1_000_000) <= r.walkaway_price <= deal.purchase_price * Decimal("5")


def test_price_above_walkaway_fails_a_hurdle():
    deal = make_deal()
    r = solve_max_price(deal)
    above = r.walkaway_price * Decimal("1.10")
    res = underwrite(replace(deal, purchase_price=above))
    t = deal.targets
    fails = (
        (res.irr is not None and res.irr < t.target_irr)
        or (res.dscr is not None and res.dscr < t.min_dscr)
        or (res.cash_on_cash is not None and res.cash_on_cash < t.min_cash_on_cash)
    )
    assert fails


def test_price_below_walkaway_meets_hurdles():
    deal = make_deal()
    r = solve_max_price(deal)
    below = r.walkaway_price * Decimal("0.90")
    res = underwrite(replace(deal, purchase_price=below))
    t = deal.targets
    assert res.irr >= t.target_irr
    assert res.dscr >= t.min_dscr
    assert res.cash_on_cash >= t.min_cash_on_cash


def test_higher_price_lowers_dscr():
    deal = make_deal()
    low = underwrite(replace(deal, purchase_price=Money.won(900_000_000)))
    high = underwrite(replace(deal, purchase_price=Money.won(1_300_000_000)))
    assert high.dscr < low.dscr


def test_infeasible_when_operating_loss():
    # NOI is negative (opex > income) -> DSCR negative at every price -> no
    # price can satisfy the hurdles.
    from tests.conftest import make_opex, make_rent_roll

    deal = make_deal(
        rent_roll=make_rent_roll(n=12, rent=100_000),   # tiny rents
        opex=make_opex(40_000_000),                      # heavy opex
    )
    r = solve_max_price(deal)
    assert not r.feasible
    assert r.walkaway_price is None
    assert r.binding_constraint is not None


def test_binding_constraint_reported():
    r = solve_max_price(make_deal())
    assert r.binding_constraint in {"target_irr", "min_dscr", "min_cash_on_cash"}


def test_solver_is_deterministic():
    deal = make_deal()
    a = solve_max_price(deal).walkaway_price
    b = solve_max_price(deal).walkaway_price
    assert a == b
