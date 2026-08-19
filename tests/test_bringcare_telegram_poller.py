import logging

import pytest

from automation.bringcare_telegram.client import TelegramAuthError, TelegramTemporaryError
from automation.bringcare_telegram.poller import (
    PollerLockError,
    SingleInstanceLock,
    main,
    run_poller,
)


class Lock:
    def __init__(self, *, fail=False):
        self.fail = fail
        self.entered = False
        self.exited = False

    def __enter__(self):
        if self.fail:
            raise PollerLockError("busy")
        self.entered = True
        return self

    def __exit__(self, *_):
        self.exited = True


def test_long_polls_with_bounded_timeout_and_does_not_busy_spin():
    calls = []
    lock = Lock()

    def runner(*, timeout):
        calls.append(timeout)
        if len(calls) == 3:
            raise KeyboardInterrupt
        return {"status": "ok", "updates": 0}

    assert run_poller(runner=runner, lock=lock, timeout=50, sleep=lambda _: None) == 0
    assert calls == [50, 50, 50]
    assert lock.entered and lock.exited


def test_transient_failures_retry_with_bounded_exponential_backoff():
    sleeps = []
    attempts = 0

    def runner(*, timeout):
        nonlocal attempts
        attempts += 1
        if attempts < 5:
            raise TelegramTemporaryError("contains private detail")
        raise KeyboardInterrupt

    assert run_poller(
        runner=runner,
        lock=Lock(),
        timeout=40,
        sleep=sleeps.append,
        initial_backoff=1,
        max_backoff=4,
    ) == 0
    assert sleeps == [1, 2, 4, 4]


def test_success_resets_backoff():
    sleeps = []
    outcomes = [TelegramTemporaryError(), {}, TelegramTemporaryError(), KeyboardInterrupt()]

    def runner(*, timeout):
        outcome = outcomes.pop(0)
        if isinstance(outcome, BaseException):
            raise outcome
        return outcome

    run_poller(runner=runner, lock=Lock(), sleep=sleeps.append)
    assert sleeps == [1, 1]


def test_lock_prevents_second_instance_and_releases_on_runner_exception():
    busy = Lock(fail=True)
    assert run_poller(runner=lambda **_: None, lock=busy, sleep=lambda _: None) == 2

    held = Lock()
    with pytest.raises(ValueError):
        run_poller(
            runner=lambda **_: (_ for _ in ()).throw(ValueError("bad config")),
            lock=held,
            sleep=lambda _: None,
        )
    assert held.exited


def test_kernel_lock_rejects_concurrent_owner_and_accepts_stale_sidecar(tmp_path):
    path = tmp_path / "poller.lock"
    path.write_text("999999", encoding="ascii")

    with SingleInstanceLock(path):
        with pytest.raises(PollerLockError):
            with SingleInstanceLock(path):
                pass

    with SingleInstanceLock(path):
        pass
    assert path.read_text(encoding="ascii").isdigit()


def test_fatal_auth_error_exits_nonzero_without_retry():
    sleeps = []
    code = main(
        runner=lambda **_: (_ for _ in ()).throw(TelegramAuthError("secret token")),
        lock=Lock(),
        sleep=sleeps.append,
    )
    assert code != 0
    assert sleeps == []


def test_status_logs_do_not_include_exception_or_raw_result(caplog):
    outcomes = [TelegramTemporaryError("TOKEN=secret raw user text"), KeyboardInterrupt()]

    def runner(**_):
        raise outcomes.pop(0)

    with caplog.at_level(logging.INFO):
        run_poller(runner=runner, lock=Lock(), sleep=lambda _: None)
    text = caplog.text
    assert "TOKEN=secret" not in text
    assert "raw user text" not in text
    assert "temporary_error" in text


@pytest.mark.parametrize("timeout", [-1, 51])
def test_timeout_is_bounded(timeout):
    with pytest.raises(ValueError, match="0 and 50"):
        run_poller(runner=lambda **_: None, lock=Lock(), timeout=timeout)
