"""Rent Roll — per-unit lease data and the aggregates derived from it.

Deposits (보증금) are collected here but are NEVER treated as income. They are a
liability handled by Sources & Uses and the real-leverage metric.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from decimal import Decimal
from typing import Optional

from .money import Money


@dataclass(frozen=True)
class Unit:
    """A single leasable unit (호실)."""

    unit_id: str
    area_m2: Decimal
    deposit: Money
    monthly_rent: Money
    management_fee: Money = field(default_factory=lambda: Money.zero())
    occupied: bool = True
    arrears: Money = field(default_factory=lambda: Money.zero())
    market_rent: Optional[Money] = None
    target_rent: Optional[Money] = None
    lease_start: Optional[str] = None  # ISO date string; kept opaque in EPIC 01
    lease_end: Optional[str] = None

    def __post_init__(self) -> None:
        if self.monthly_rent.amount < 0:
            raise ValueError(f"unit {self.unit_id}: monthly_rent cannot be negative")
        if self.deposit.amount < 0:
            raise ValueError(f"unit {self.unit_id}: deposit cannot be negative")

    @property
    def annual_rent(self) -> Money:
        return self.monthly_rent * 12


@dataclass(frozen=True)
class RentRoll:
    """A collection of units for one property, with derived aggregates.

    ``gpr_*`` is Gross Potential Rent — every unit at its contract rent, fully
    occupied. Vacancy is applied later (in the Operating Statement / cashflow),
    not here.
    """

    units: tuple[Unit, ...]
    currency: str = "KRW"

    def __post_init__(self) -> None:
        if not self.units:
            raise ValueError("rent roll must contain at least one unit")
        ids = [u.unit_id for u in self.units]
        if len(ids) != len(set(ids)):
            raise ValueError("duplicate unit_id in rent roll")

    @property
    def unit_count(self) -> int:
        return len(self.units)

    @property
    def gpr_monthly(self) -> Money:
        total = Money.zero(self.currency)
        for u in self.units:
            total += u.monthly_rent
        return total

    @property
    def gpr_annual(self) -> Money:
        return self.gpr_monthly * 12

    @property
    def total_deposits(self) -> Money:
        total = Money.zero(self.currency)
        for u in self.units:
            total += u.deposit
        return total

    @property
    def total_arrears(self) -> Money:
        total = Money.zero(self.currency)
        for u in self.units:
            total += u.arrears
        return total

    @property
    def occupied_count(self) -> int:
        return sum(1 for u in self.units if u.occupied)

    @property
    def physical_occupancy(self) -> Decimal:
        """Occupied units / total units (호실 기준 물리적 점유율)."""
        return Decimal(self.occupied_count) / Decimal(self.unit_count)

    @property
    def economic_occupancy(self) -> Decimal:
        """Rent from occupied units / GPR (임대료 가중 점유율)."""
        gpr = self.gpr_monthly.amount
        if gpr == 0:
            return Decimal(0)
        occ = Money.zero(self.currency)
        for u in self.units:
            if u.occupied:
                occ += u.monthly_rent
        return occ.amount / gpr

    def rent_gap_to_market(self) -> Money:
        """Annual upside if every unit moved to its market rent."""
        gap = Money.zero(self.currency)
        for u in self.units:
            if u.market_rent is not None:
                gap += (u.market_rent - u.monthly_rent) * 12
        return gap


__all__ = ["Unit", "RentRoll"]
