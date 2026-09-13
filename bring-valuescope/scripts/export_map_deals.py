"""Build a small set of demo deals, run each through the engine, and emit a
JS data file (window.VALUESCOPE_DEALS) for the Naver map page.

Coordinates are entered directly on each deal (MVP: no geocoding server).
"""

from __future__ import annotations

import json
import sys
from dataclasses import replace
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from valuescope.engine import DataFlags, FinancingSpec, InvestmentTargets  # noqa: E402
from valuescope.engine.analyze import analyze  # noqa: E402
from valuescope.io_json import deal_from_dict  # noqa: E402

BASE = json.loads((Path(__file__).resolve().parents[1] / "examples" / "sample_deal.json").read_text("utf-8"))


def won(m):
    return int(m.rounded().amount)


def summary(deal, data, meta):
    a = analyze(deal, data=data)
    d = a.decision
    b = a.base
    return {
        "id": meta["id"],
        "name": meta["name"],
        "address": meta["address"],
        "lat": meta["lat"],
        "lng": meta["lng"],
        "stage": meta["stage"],
        "asset_type": meta["asset_type"],
        "verdict": d.verdict.value,
        "asking_price": won(deal.purchase_price),
        "recommended_price": won(d.recommended_price) if d.recommended_price else None,
        "walkaway_price": won(d.walkaway_price) if d.walkaway_price else None,
        "required_equity": won(b.required_equity),
        "stabilized_noi": won(b.stabilized_noi),
        "unit_count": deal.rent_roll.unit_count,
        "dscr": float(b.dscr.quantize(Decimal("0.01"))) if b.dscr else None,
        "irr": float(b.irr.quantize(Decimal("0.0001"))) if b.irr else None,
        "coc": float(b.cash_on_cash.quantize(Decimal("0.0001"))) if b.cash_on_cash else None,
        "downside_dscr": float(a.scenarios["downside"].result.dscr.quantize(Decimal("0.01")))
        if a.scenarios["downside"].result.dscr else None,
        "hard_stops": list(d.hard_stops),
        "conditions": list(d.conditions),
        "top_risks": list(d.top_risks),
    }


def main():
    deals = []

    # 1) GO — the healthy base deal
    deal, data = deal_from_dict(BASE)
    deals.append(summary(deal, data, {
        "id": "wj-001", "name": "무실동 원룸 12호", "address": "강원 원주시 무실동",
        "lat": 37.3380, "lng": 127.9160, "stage": "투자심의", "asset_type": "다가구·원룸",
    }))

    # 2) CONDITIONAL_GO — aggressive hurdle (asking above walk-away)
    deal2 = replace(deal, targets=replace(deal.targets, target_irr=Decimal("0.35")))
    deals.append(summary(deal2, data, {
        "id": "wj-002", "name": "단계동 다가구 10호", "address": "강원 원주시 단계동",
        "lat": 37.3505, "lng": 127.9315, "stage": "협상중", "asset_type": "다가구·원룸",
    }))

    # 3) NO_GO — high leverage + high rate breaks downside coverage
    deal3 = replace(deal, financing=FinancingSpec(
        ltv_target=Decimal("0.80"), rate=__import__("valuescope").Rate.percent("6"), term_months=240))
    deals.append(summary(deal3, data, {
        "id": "wj-003", "name": "우산동 근생+주택", "address": "강원 원주시 우산동",
        "lat": 37.3628, "lng": 127.9240, "stage": "분석중", "asset_type": "상가주택",
    }))

    # 4) REVIEW — missing deposit / senior-lien data
    deals.append(summary(deal, DataFlags(deposit_data_complete=False), {
        "id": "wj-004", "name": "명륜동 다중주택 16호", "address": "강원 원주시 명륜동",
        "lat": 37.3452, "lng": 127.9430, "stage": "자료부족", "asset_type": "다중주택",
    }))

    center = {"lat": 37.3452, "lng": 127.9280}
    payload = {"center": center, "deals": deals, "engine_version": analyze(deal, data=data).base.engine_version}
    js = "window.VALUESCOPE_DEALS = " + json.dumps(payload, ensure_ascii=False, indent=2) + ";\n"
    out = Path(__file__).resolve().parents[2] / "data" / "valuescope-deals.js"
    out.write_text(js, encoding="utf-8")
    print(f"wrote {out} ({len(deals)} deals)")
    for d in deals:
        print(f"  {d['id']} {d['name']}: {d['verdict']}  DSCR={d['dscr']} downside={d['downside_dscr']}")


if __name__ == "__main__":
    main()
