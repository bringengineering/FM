"""Golden-case suite: verdict + directional invariant per archetype."""

from __future__ import annotations

import pytest

from valuescope import ENGINE_VERSION
from valuescope.engine import analyze
from tests.golden.cases import GOLDEN_CASES


@pytest.mark.parametrize("case", GOLDEN_CASES, ids=[c.name for c in GOLDEN_CASES])
def test_golden_verdict(case):
    a = analyze(case.deal, data=case.data)
    assert a.decision.verdict == case.expected_verdict, (
        f"{case.name}: expected {case.expected_verdict}, got {a.decision.verdict} "
        f"(DSCR={a.base.dscr}, IRR={a.base.irr}, walkaway={a.solver.walkaway_price})"
    )


@pytest.mark.parametrize("case", GOLDEN_CASES, ids=[c.name for c in GOLDEN_CASES])
def test_golden_invariant(case):
    a = analyze(case.deal, data=case.data)
    if case.invariant is not None:
        assert case.invariant(a), f"{case.name}: invariant failed — {case.invariant_desc}"


@pytest.mark.parametrize("case", GOLDEN_CASES, ids=[c.name for c in GOLDEN_CASES])
def test_golden_results_carry_engine_version(case):
    a = analyze(case.deal, data=case.data)
    assert a.base.engine_version == ENGINE_VERSION
    assert a.to_dict()["base"]["engine_version"] == ENGINE_VERSION
