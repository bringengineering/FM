"""One-call deal analysis: underwrite + scenarios + solver + decision.

This is what the API and CLI call. It returns a single dict that mirrors, 1:1,
what a report or web screen shows (MVP completion criterion: JSON and screen
must be identical).
"""

from __future__ import annotations

from dataclasses import dataclass

from .decision import DataFlags, DecisionResult, decide
from .scenario import ScenarioResult, run_scenarios
from .solver import SolverResult, solve_max_price
from .underwrite import DealInputs, UnderwriteResult, underwrite


@dataclass(frozen=True)
class DealAnalysis:
    base: UnderwriteResult
    scenarios: dict
    solver: SolverResult
    decision: DecisionResult

    def to_dict(self) -> dict:
        return {
            "base": self.base.to_dict(),
            "scenarios": {
                name: sr.result.to_dict() for name, sr in self.scenarios.items()
            },
            "walkaway_price": (
                int(self.solver.walkaway_price.rounded().amount)
                if self.solver.walkaway_price is not None
                else None
            ),
            "solver_feasible": self.solver.feasible,
            "solver_binding_constraint": self.solver.binding_constraint,
            "decision": self.decision.to_dict(),
        }


def analyze(deal: DealInputs, data: DataFlags = DataFlags()) -> DealAnalysis:
    base = underwrite(deal)
    scenarios = run_scenarios(deal)
    solver = solve_max_price(deal)
    decision = decide(deal, base, scenarios, solver, data)
    return DealAnalysis(base=base, scenarios=scenarios, solver=solver, decision=decision)


__all__ = ["DealAnalysis", "analyze"]
