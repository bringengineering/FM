"""FastAPI thin layer over the Financial Underwriting Core.

The API does no math of its own — it validates the request shape, hands a plain
dict to the deterministic engine via ``deal_from_dict`` + ``analyze``, and
returns the engine's dict verbatim. This guarantees the HTTP response equals the
CLI/JSON output for the same deal.

Run:
    pip install -e ".[api]"
    uvicorn apps.api.main:app --reload
"""

from __future__ import annotations

from typing import Any, Dict

try:
    from fastapi import FastAPI, HTTPException
except ImportError as exc:  # pragma: no cover - API extra not installed
    raise SystemExit(
        "FastAPI is not installed. Install API extras: pip install -e '.[api]'"
    ) from exc

from valuescope import ENGINE_VERSION
from valuescope.engine.analyze import analyze
from valuescope.io_json import deal_from_dict

app = FastAPI(
    title="BRING ValueScope — Financial Underwriting Core",
    version=ENGINE_VERSION,
    description="Deterministic underwriting for 원룸·다가구 income properties. "
    "No AI, no external calls — numbers only.",
)


@app.get("/health")
def health() -> Dict[str, str]:
    return {"status": "ok", "engine_version": ENGINE_VERSION}


@app.post("/analyze")
def analyze_deal(payload: Dict[str, Any]) -> Dict[str, Any]:
    """Analyse a full deal payload and return metrics + scenarios + decision.

    The response is identical to `python -m valuescope.cli <file>`.
    """
    try:
        deal, data = deal_from_dict(payload)
    except (KeyError, ValueError) as exc:
        raise HTTPException(status_code=422, detail=f"invalid deal payload: {exc}") from exc
    return analyze(deal, data=data).to_dict()


@app.post("/max-price")
def max_price(payload: Dict[str, Any]) -> Dict[str, Any]:
    """Return just the walk-away price (절대 상한가) and its binding constraint."""
    from valuescope.engine.solver import solve_max_price

    try:
        deal, _ = deal_from_dict(payload)
    except (KeyError, ValueError) as exc:
        raise HTTPException(status_code=422, detail=f"invalid deal payload: {exc}") from exc
    r = solve_max_price(deal)
    return {
        "feasible": r.feasible,
        "walkaway_price": None if r.walkaway_price is None else int(r.walkaway_price.rounded().amount),
        "binding_constraint": r.binding_constraint,
        "engine_version": ENGINE_VERSION,
    }
