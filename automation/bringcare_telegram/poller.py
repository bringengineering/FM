"""Long-running, local-only supervisor for Telegram remote commands."""

from __future__ import annotations

import logging
import sys
import time
from typing import Callable

from .cli import process_remote_once
from .locking import LOCK_PATH, PollerLockError, SingleInstanceLock
from .client import (
    TelegramAuthError,
    TelegramForbiddenError,
    TelegramRateLimitError,
    TelegramTemporaryError,
)


LOGGER = logging.getLogger("bringcare.telegram.poller")
TRANSIENT_ERRORS = (
    TelegramTemporaryError,
    TelegramRateLimitError,
)


def run_poller(
    *,
    runner: Callable[..., dict] = process_remote_once,
    lock: AbstractContextManager | None = None,
    sleep: Callable[[float], None] = time.sleep,
    timeout: int = 50,
    initial_backoff: float = 1,
    max_backoff: float = 30,
    idle_sleep: float = 0.1,
) -> int:
    if not 0 <= timeout <= 50:
        raise ValueError("timeout must be between 0 and 50 seconds")
    if initial_backoff <= 0 or max_backoff < initial_backoff:
        raise ValueError("backoff bounds are invalid")

    try:
        with lock if lock is not None else SingleInstanceLock():
            delay = initial_backoff
            LOGGER.info("status=started")
            while True:
                try:
                    result = runner(timeout=timeout)
                    delay = initial_backoff
                    LOGGER.info("status=polled")
                    if isinstance(result, dict) and result.get("updates") == 0:
                        sleep(idle_sleep)
                except TRANSIENT_ERRORS:
                    LOGGER.warning("status=temporary_error retry_seconds=%s", delay)
                    sleep(delay)
                    delay = min(max_backoff, delay * 2)
    except PollerLockError:
        LOGGER.error("status=already_running")
        return 2
    except KeyboardInterrupt:
        LOGGER.info("status=stopped")
        return 0


def main(*, runner=process_remote_once, lock=None, sleep=time.sleep) -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    try:
        return run_poller(runner=runner, lock=lock, sleep=sleep)
    except (FileNotFoundError, ValueError, KeyError):
        LOGGER.error("status=fatal_config_error")
        return 3
    except (TelegramAuthError, TelegramForbiddenError):
        LOGGER.error("status=fatal_auth_error")
        return 4
    except Exception:
        LOGGER.error("status=fatal_unexpected_error")
        return 5


if __name__ == "__main__":
    raise SystemExit(main())
