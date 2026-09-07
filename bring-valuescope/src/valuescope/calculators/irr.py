"""IRR / NPV / Equity Multiple over Decimal cash-flow streams.

IRR is found by bisection on the NPV function. Bisection (not Newton) is chosen
for determinism and guaranteed convergence within a bracket — the same inputs
always yield the same rate, which the golden-case tests depend on.
"""

from __future__ import annotations

from decimal import Decimal
from typing import List, Optional, Sequence

from ..domain.money import Money


def npv(rate: Decimal, cash_flows: Sequence[Money]) -> Decimal:
    """Net present value of period-indexed cash flows (index 0 = today)."""
    total = Decimal(0)
    one_plus = Decimal(1) + rate
    for t, cf in enumerate(cash_flows):
        total += cf.amount / (one_plus ** t)
    return total


def _amounts(cash_flows: Sequence[Money]) -> List[Decimal]:
    return [cf.amount for cf in cash_flows]


def irr(
    cash_flows: Sequence[Money],
    *,
    low: Decimal = Decimal("-0.9999"),
    high: Decimal = Decimal("10"),
    tolerance: Decimal = Decimal("0.0000001"),
    max_iter: int = 200,
) -> Optional[Decimal]:
    """Internal rate of return, or None if no sign change (no real IRR bracket).

    Requires at least one negative and one positive cash flow. Returns the rate
    r such that NPV(r) ≈ 0 within ``tolerance`` on the rate.
    """
    amounts = _amounts(cash_flows)
    if not any(a < 0 for a in amounts) or not any(a > 0 for a in amounts):
        return None

    f_low = npv(low, cash_flows)
    f_high = npv(high, cash_flows)
    if f_low == 0:
        return low
    if f_high == 0:
        return high
    if (f_low > 0) == (f_high > 0):
        # No sign change in the bracket -> IRR outside [low, high]; undefined here.
        return None

    lo, hi = low, high
    for _ in range(max_iter):
        mid = (lo + hi) / Decimal(2)
        f_mid = npv(mid, cash_flows)
        if f_mid == 0 or (hi - lo) / Decimal(2) < tolerance:
            return mid
        if (f_mid > 0) == (f_low > 0):
            lo = mid
            f_low = f_mid
        else:
            hi = mid
    return (lo + hi) / Decimal(2)


def equity_multiple(cash_flows: Sequence[Money]) -> Optional[Decimal]:
    """Total distributions / total contributions (absolute value of outflows)."""
    inflows = sum((a for a in _amounts(cash_flows) if a > 0), Decimal(0))
    outflows = sum((-a for a in _amounts(cash_flows) if a < 0), Decimal(0))
    if outflows == 0:
        return None
    return inflows / outflows


__all__ = ["npv", "irr", "equity_multiple"]
