"""BRING ValueScope — Financial Underwriting Core (EPIC 01).

A deterministic, Decimal-only engine that answers, for a small residential
income property (원룸·다가구): how much equity is needed, what the stabilized NOI
is, whether it survives the downside, and — above all — the maximum price one
should ever pay (절대 상한가 / walk-away price).

No public API, no AI, no I/O in this package. Numbers only.
"""

from .domain import (
    LoanQuote,
    Money,
    OperatingExpenses,
    OperatingStatement,
    Period,
    Rate,
    RentRoll,
    RepaymentType,
    Sources,
    SourcesAndUses,
    Unit,
    Uses,
)
from .engine import (
    DataFlags,
    DealAnalysis,
    DealInputs,
    FinancingSpec,
    InvestmentTargets,
    Verdict,
    analyze,
    solve_max_price,
    underwrite,
)
from .version import ENGINE_VERSION

__all__ = [
    "ENGINE_VERSION",
    "Money",
    "Rate",
    "Period",
    "Unit",
    "RentRoll",
    "OperatingExpenses",
    "OperatingStatement",
    "LoanQuote",
    "RepaymentType",
    "Uses",
    "Sources",
    "SourcesAndUses",
    "DealInputs",
    "FinancingSpec",
    "InvestmentTargets",
    "underwrite",
    "analyze",
    "DealAnalysis",
    "solve_max_price",
    "DataFlags",
    "Verdict",
]
