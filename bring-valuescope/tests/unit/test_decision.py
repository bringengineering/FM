"""Decision (GO/CONDITIONAL_GO/REVIEW/NO_GO) and hard-stop tests."""

from __future__ import annotations

from dataclasses import replace
from decimal import Decimal

from valuescope import Money, Rate
from valuescope.engine import DataFlags, FinancingSpec, Verdict, analyze
from tests.conftest import make_deal


def test_good_deal_is_go():
    a = analyze(make_deal())
    assert a.decision.verdict == Verdict.GO
    assert a.decision.hard_stops == ()


def test_go_sets_recommended_below_walkaway():
    a = analyze(make_deal())
    assert a.decision.recommended_price < a.decision.walkaway_price


def test_missing_deposit_data_is_review():
    a = analyze(make_deal(), data=DataFlags(deposit_data_complete=False))
    assert a.decision.verdict == Verdict.REVIEW
    assert any("보증금" in c for c in a.decision.conditions)


def test_missing_senior_lien_data_is_review():
    a = analyze(make_deal(), data=DataFlags(senior_lien_data_complete=False))
    assert a.decision.verdict == Verdict.REVIEW


def test_refinance_dependent_is_hard_stop_no_go():
    a = analyze(make_deal(), data=DataFlags(refinance_dependent=True))
    assert a.decision.verdict == Verdict.NO_GO
    assert any("재대출" in h or "대환" in h for h in a.decision.hard_stops)


def test_thin_coverage_downside_triggers_no_go():
    # high leverage + high rate + modest rents -> downside DSCR < 1.0
    deal = make_deal(
        financing=FinancingSpec(ltv_target=Decimal("0.80"), rate=Rate.percent("6"), term_months=240),
    )
    a = analyze(deal)
    assert a.decision.verdict == Verdict.NO_GO
    assert any("DSCR" in h for h in a.decision.hard_stops)


def test_hard_stop_beats_high_score():
    # Even with strong rents, a refinance-dependent flag forces NO_GO.
    a = analyze(make_deal(), data=DataFlags(refinance_dependent=True))
    assert a.base.irr > Decimal("0.12")  # attractive returns...
    assert a.decision.verdict == Verdict.NO_GO  # ...still blocked


def test_unmet_target_irr_is_conditional_go():
    # returns are fine but the hurdle is set just above them -> conditional
    deal = make_deal(targets=replace(make_deal().targets, target_irr=Decimal("0.35")))
    a = analyze(deal)
    assert a.decision.verdict == Verdict.CONDITIONAL_GO
    assert a.decision.hard_stops == ()
    assert len(a.decision.conditions) > 0


def test_asking_above_walkaway_is_conditional_go():
    deal = make_deal(targets=replace(make_deal().targets, target_irr=Decimal("0.35")))
    a = analyze(deal)
    assert a.decision.asking_price > a.decision.walkaway_price


def test_decision_dict_roundtrip():
    a = analyze(make_deal())
    d = a.decision.to_dict()
    assert d["verdict"] == "GO"
    assert set(d) >= {"verdict", "hard_stops", "conditions", "top_risks",
                      "recommended_price", "walkaway_price", "asking_price"}


def test_top_risks_capped_at_five():
    a = analyze(make_deal())
    assert len(a.decision.top_risks) <= 5
