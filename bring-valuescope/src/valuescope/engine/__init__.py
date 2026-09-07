"""Underwriting orchestration: deal -> metrics -> scenarios -> decision."""

from .analyze import DealAnalysis, analyze
from .decision import DataFlags, DecisionResult, Verdict, decide
from .scenario import (
    BASE,
    DEFAULT_SCENARIOS,
    DOWNSIDE,
    STATUS_QUO,
    UPSIDE,
    ScenarioDelta,
    ScenarioResult,
    run_scenarios,
)
from .solver import SolverResult, solve_max_price
from .underwrite import (
    DealInputs,
    FinancingSpec,
    InvestmentTargets,
    UnderwriteResult,
    underwrite,
)

__all__ = [
    "analyze",
    "DealAnalysis",
    "underwrite",
    "DealInputs",
    "FinancingSpec",
    "InvestmentTargets",
    "UnderwriteResult",
    "run_scenarios",
    "ScenarioDelta",
    "ScenarioResult",
    "STATUS_QUO",
    "BASE",
    "UPSIDE",
    "DOWNSIDE",
    "DEFAULT_SCENARIOS",
    "solve_max_price",
    "SolverResult",
    "decide",
    "DataFlags",
    "DecisionResult",
    "Verdict",
]
