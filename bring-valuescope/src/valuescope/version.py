"""Engine and assumption versioning.

CLAUDE.md rule: every calculation result must store the engine version and the
assumption (input) version so results are reproducible.
"""

from __future__ import annotations

# Bump ENGINE_VERSION whenever a formula changes. Golden cases are pinned to it.
ENGINE_VERSION = "0.1.0"

__all__ = ["ENGINE_VERSION"]
