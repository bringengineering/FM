"""Money, Rate, Period — the primitive value types for BRING ValueScope.

Absolute rules (see CLAUDE.md):
- Money math NEVER uses ``float``. Everything is ``Decimal``.
- Values are stored exactly; rounding happens only for display or when a
  currency-specific settlement rounding is explicitly requested.
- KRW settles to the whole won (1원 단위) using banker's-free ROUND_HALF_UP,
  which matches how Korean invoices and loan schedules round.
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation
from typing import Union

Numeric = Union[int, str, Decimal]

# Minor-unit exponent per currency. KRW has no minor unit (round to 1원).
_CURRENCY_QUANT = {
    "KRW": Decimal("1"),
    "USD": Decimal("0.01"),
}


def _to_decimal(value: Numeric) -> Decimal:
    if isinstance(value, Decimal):
        return value
    if isinstance(value, bool):  # bool is an int subclass; reject to avoid surprises
        raise TypeError("bool is not a valid Money amount")
    if isinstance(value, (int, str)):
        try:
            return Decimal(value)
        except InvalidOperation as exc:  # pragma: no cover - defensive
            raise ValueError(f"cannot parse amount: {value!r}") from exc
    if isinstance(value, float):
        raise TypeError(
            "float is not allowed for Money — pass int, str, or Decimal (CLAUDE.md rule)"
        )
    raise TypeError(f"unsupported amount type: {type(value)!r}")


@dataclass(frozen=True, order=False)
class Money:
    """An exact monetary amount in a single currency.

    Use :meth:`rounded` to settle to the currency's minor unit for display or
    cash settlement. Comparisons and arithmetic keep full precision.
    """

    amount: Decimal
    currency: str = "KRW"

    def __init__(self, amount: Numeric, currency: str = "KRW") -> None:
        object.__setattr__(self, "amount", _to_decimal(amount))
        object.__setattr__(self, "currency", currency)

    # --- construction helpers -------------------------------------------------
    @classmethod
    def zero(cls, currency: str = "KRW") -> "Money":
        return cls(Decimal(0), currency)

    @classmethod
    def won(cls, amount: Numeric) -> "Money":
        return cls(amount, "KRW")

    # --- invariants -----------------------------------------------------------
    def _check(self, other: "Money") -> None:
        if not isinstance(other, Money):
            raise TypeError(f"expected Money, got {type(other)!r}")
        if other.currency != self.currency:
            raise ValueError(
                f"currency mismatch: {self.currency} vs {other.currency}"
            )

    # --- arithmetic -----------------------------------------------------------
    def __add__(self, other: "Money") -> "Money":
        self._check(other)
        return Money(self.amount + other.amount, self.currency)

    def __sub__(self, other: "Money") -> "Money":
        self._check(other)
        return Money(self.amount - other.amount, self.currency)

    def __mul__(self, factor: Numeric) -> "Money":
        return Money(self.amount * _to_decimal(factor), self.currency)

    __rmul__ = __mul__

    def __truediv__(self, divisor: Union[Numeric, "Money"]):
        if isinstance(divisor, Money):
            self._check(divisor)
            if divisor.amount == 0:
                raise ZeroDivisionError("division by zero Money")
            return self.amount / divisor.amount  # ratio -> Decimal
        d = _to_decimal(divisor)
        if d == 0:
            raise ZeroDivisionError("division by zero")
        return Money(self.amount / d, self.currency)

    def __neg__(self) -> "Money":
        return Money(-self.amount, self.currency)

    def __abs__(self) -> "Money":
        return Money(abs(self.amount), self.currency)

    # --- comparisons ----------------------------------------------------------
    def __eq__(self, other: object) -> bool:
        if not isinstance(other, Money):
            return NotImplemented
        return self.currency == other.currency and self.amount == other.amount

    def __lt__(self, other: "Money") -> bool:
        self._check(other)
        return self.amount < other.amount

    def __le__(self, other: "Money") -> bool:
        self._check(other)
        return self.amount <= other.amount

    def __gt__(self, other: "Money") -> bool:
        self._check(other)
        return self.amount > other.amount

    def __ge__(self, other: "Money") -> bool:
        self._check(other)
        return self.amount >= other.amount

    def __hash__(self) -> int:
        return hash((self.amount, self.currency))

    # --- rounding / display ---------------------------------------------------
    def rounded(self) -> "Money":
        """Settle to the currency's minor unit (KRW -> whole won)."""
        quant = _CURRENCY_QUANT.get(self.currency, Decimal("0.01"))
        return Money(self.amount.quantize(quant, rounding=ROUND_HALF_UP), self.currency)

    def is_zero(self) -> bool:
        return self.amount == 0

    def is_positive(self) -> bool:
        return self.amount > 0

    def __str__(self) -> str:
        if self.currency == "KRW":
            return f"{self.rounded().amount:,}원"
        return f"{self.amount} {self.currency}"

    def __repr__(self) -> str:
        return f"Money({self.amount!s}, {self.currency!r})"


@dataclass(frozen=True)
class Rate:
    """An annual rate stored as a fraction (0.045 == 4.5%).

    ``value`` is the annual fraction. Use :meth:`monthly` for a monthly
    compounding-free (nominal/12) rate, which is the convention Korean banks use
    for 원리금균등 amortization schedules.
    """

    value: Decimal

    def __init__(self, value: Numeric) -> None:
        object.__setattr__(self, "value", _to_decimal(value))

    @classmethod
    def percent(cls, pct: Numeric) -> "Rate":
        return cls(_to_decimal(pct) / Decimal(100))

    @classmethod
    def bps(cls, basis_points: Numeric) -> "Rate":
        return cls(_to_decimal(basis_points) / Decimal(10000))

    @property
    def monthly(self) -> Decimal:
        return self.value / Decimal(12)

    @property
    def as_percent(self) -> Decimal:
        return self.value * Decimal(100)

    def __add__(self, other: "Rate") -> "Rate":
        return Rate(self.value + other.value)

    def __sub__(self, other: "Rate") -> "Rate":
        return Rate(self.value - other.value)

    def __str__(self) -> str:
        return f"{self.as_percent}%"


@dataclass(frozen=True)
class Period:
    """A duration in whole months."""

    months: int

    def __post_init__(self) -> None:
        if not isinstance(self.months, int) or isinstance(self.months, bool):
            raise TypeError("Period.months must be int")
        if self.months < 0:
            raise ValueError("Period cannot be negative")

    @classmethod
    def years(cls, n: Numeric) -> "Period":
        return cls(int(_to_decimal(n) * 12))

    @property
    def as_years(self) -> Decimal:
        return Decimal(self.months) / Decimal(12)

    def __str__(self) -> str:
        return f"{self.months}개월"


__all__ = ["Money", "Rate", "Period", "Numeric"]
