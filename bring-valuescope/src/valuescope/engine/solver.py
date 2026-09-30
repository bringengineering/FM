"""Maximum purchase price ("walk-away price") solver.

The single most important output (PRD 7.6): the highest price at which the deal
still clears every investment hurdle.

Why bisection works: over the region where required equity is positive, raising
the price raises equity and debt service while NOI stays fixed, so IRR, DSCR and
Cash-on-Cash all fall *monotonically*. The real-leverage ceiling
((loan+deposits)/price) only ever *improves* as price rises, so it never binds
the maximum price — it is a floor on price, not a cap. The solver therefore
searches the return hurdles for the ceiling and reports the leverage status at
that ceiling separately.
"""

from __future__ import annotations

from dataclasses import dataclass, replace
from decimal import Decimal
from typing import Optional

from ..domain.money import Money
from .underwrite import DealInputs, UnderwriteResult, underwrite

_INF = Decimal("1e18")


@dataclass(frozen=True)
class SolverResult:
    feasible: bool
    walkaway_price: Optional[Money]
    binding_constraint: Optional[str]
    iterations: int
    at_price: Optional[UnderwriteResult]
    leverage_ok_at_ceiling: bool = True
    note: str = ""


def _return_margins(res: UnderwriteResult, deal: DealInputs) -> dict:
    """Margins for the price-monotonic return hurdles (>= 0 means satisfied).

    Handled carefully so a low price with large assumed deposits (equity <= 0)
    is still judged on its *operating* merits:
    - DSCR uses NOI directly, so a negative-NOI deal fails at every price.
    - Cash-on-Cash is undefined when no net cash is invested; there it is
      treated as satisfied (infinite return), NOT the whole hurdle set.
    - IRR falls back to the equity cash-flow sign pattern when the bracket
      yields no finite rate.
    """
    t = deal.targets

    # IRR
    if res.irr is not None:
        irr_margin = res.irr - t.target_irr
    else:
        amounts = [cf.amount for cf in res.projection.equity_cash_flows]
        has_neg = any(a < 0 for a in amounts)
        has_pos = any(a > 0 for a in amounts)
        # all-outflow -> catastrophic; otherwise IRR is beyond the bracket (huge).
        irr_margin = -_INF if (has_neg and not has_pos) else _INF

    # DSCR (catches operating losses regardless of financing)
    dscr_margin = (res.dscr - t.min_dscr) if res.dscr is not None else _INF

    # Cash-on-Cash
    if res.required_equity.amount <= 0:
        coc_margin = _INF  # no net cash invested -> infinite CoC
    elif res.cash_on_cash is not None:
        coc_margin = res.cash_on_cash - t.min_cash_on_cash
    else:
        coc_margin = _INF

    return {"target_irr": irr_margin, "min_dscr": dscr_margin, "min_cash_on_cash": coc_margin}


def _returns_ok(res: UnderwriteResult, deal: DealInputs) -> bool:
    return all(v >= 0 for v in _return_margins(res, deal).values())


def _binding(res: UnderwriteResult, deal: DealInputs) -> str:
    m = _return_margins(res, deal)
    return min(m, key=m.get)


def solve_max_price(
    deal: DealInputs,
    *,
    tolerance: Money = Money.won(100_000),
    max_iter: int = 100,
) -> SolverResult:
    """Bisection on price. Returns the highest price clearing every return hurdle."""
    ccy = deal.currency

    def eval_at(price: Money) -> UnderwriteResult:
        return underwrite(replace(deal, purchase_price=price))

    lo = Money(Decimal("1000000"), ccy)      # 100만원 floor (returns feasible here)
    hi = deal.purchase_price * Decimal("5")   # generous ceiling

    if not _returns_ok(eval_at(lo), deal):
        res_lo = eval_at(lo)
        return SolverResult(
            feasible=False,
            walkaway_price=None,
            binding_constraint=_binding(res_lo, deal),
            iterations=0,
            at_price=res_lo,
            note="deal fails return hurdles even at a floor price; targets unreachable",
        )

    if _returns_ok(eval_at(hi), deal):
        res_hi = eval_at(hi)
        return SolverResult(
            feasible=True,
            walkaway_price=hi.rounded(),
            binding_constraint=None,
            iterations=0,
            at_price=res_hi,
            leverage_ok_at_ceiling=res_hi.real_leverage <= deal.targets.max_real_leverage,
            note="all hurdles cleared at the search ceiling (5x asking)",
        )

    iterations = 0
    while (hi - lo).amount > tolerance.amount and iterations < max_iter:
        mid = Money((lo.amount + hi.amount) / Decimal(2), ccy)
        if _returns_ok(eval_at(mid), deal):
            lo = mid
        else:
            hi = mid
        iterations += 1

    walkaway = lo.rounded()
    at = eval_at(walkaway)
    return SolverResult(
        feasible=True,
        walkaway_price=walkaway,
        binding_constraint=_binding(eval_at(hi), deal),
        iterations=iterations,
        at_price=at,
        leverage_ok_at_ceiling=at.real_leverage <= deal.targets.max_real_leverage,
    )


__all__ = ["SolverResult", "solve_max_price"]
