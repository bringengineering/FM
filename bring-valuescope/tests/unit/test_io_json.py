"""JSON loader <-> engine equivalence (MVP: JSON and screen must match)."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from valuescope.engine import analyze
from valuescope.io_json import analysis_to_csv, deal_from_dict

SAMPLE = Path(__file__).resolve().parents[2] / "examples" / "sample_deal.json"


def load_sample() -> dict:
    return json.loads(SAMPLE.read_text(encoding="utf-8"))


def test_sample_deal_loads_and_analyses():
    deal, data = deal_from_dict(load_sample())
    a = analyze(deal, data=data)
    assert a.decision.verdict.value == "GO"


def test_float_amount_rejected():
    payload = load_sample()
    payload["purchase_price"] = 1100000000.5
    with pytest.raises(ValueError):
        deal_from_dict(payload)


def test_float_rate_rejected():
    payload = load_sample()
    payload["vacancy_rate"] = 0.05  # float -> must be string
    with pytest.raises(ValueError):
        deal_from_dict(payload)


def test_analysis_dict_is_json_serializable():
    deal, data = deal_from_dict(load_sample())
    d = analyze(deal, data=data).to_dict()
    json.dumps(d)  # must not raise


def test_csv_export_contains_key_metrics():
    deal, data = deal_from_dict(load_sample())
    csv = analysis_to_csv(analyze(deal, data=data).to_dict())
    assert "stabilized_noi" in csv
    assert "verdict" in csv


def test_loader_is_deterministic():
    d1 = analyze(*deal_from_dict(load_sample())).to_dict()
    d2 = analyze(*deal_from_dict(load_sample())).to_dict()
    assert d1 == d2
