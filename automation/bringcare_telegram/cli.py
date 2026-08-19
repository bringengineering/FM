import argparse
from dataclasses import dataclass
from pathlib import Path
import sys

from .client import TelegramAuthError, TelegramClient, TelegramForbiddenError, TelegramTemporaryError
from .config import load_public_config
from .crypto_windows import decrypt_current_user_secret
from .events import event_from_blocker
from .messages import blocked_message, published_message, ready_message
from .state import NotificationState

BASE = Path(__file__).resolve().parent


@dataclass(frozen=True)
class OutboundEvent:
    key: str
    text: str
    markup: dict | None


def send_event(event: OutboundEvent) -> bool:
    config = load_public_config(BASE / "local-config.json")
    state = NotificationState(BASE / "telegram-state.json")
    if not state.should_send(event.key): return False
    token = decrypt_current_user_secret(BASE / "token.dpapi")
    TelegramClient(token).send_message(config.chat_id, event.text, event.markup)
    state.mark_sent(event.key)
    return True


def _parser():
    parser = argparse.ArgumentParser(prog="bringcare-telegram")
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("test")
    ready = commands.add_parser("ready")
    for name in ("post-id", "title", "post-type", "category"): ready.add_argument(f"--{name}", required=True)
    blocked = commands.add_parser("blocked")
    for name in ("post-id", "title", "blocker", "stage"): blocked.add_argument(f"--{name}", required=True)
    published = commands.add_parser("published")
    for name in ("post-id", "title", "url"): published.add_argument(f"--{name}", required=True)
    return parser


def _build(args):
    if args.command == "test":
        return OutboundEvent("test", "✅ <b>브링케어 텔레그램 연결 완료</b>", None)
    if args.command == "ready":
        config = load_public_config(BASE / "local-config.json") if (BASE / "local-config.json").exists() else None
        approval = config.approval_url if config else "https://chatgpt.com/"
        text, markup = ready_message(args.title, args.post_type, args.category, approval)
        return OutboundEvent(f"ready:{args.post_id}", text, markup)
    if args.command == "blocked":
        mapped = event_from_blocker(args.blocker, args.title, args.stage, "")
        text, markup = blocked_message(args.title, args.blocker, mapped.action, args.stage)
        return OutboundEvent(f"blocked:{args.post_id}:{args.blocker}", text, markup)
    text, markup = published_message(args.title, args.url)
    return OutboundEvent(f"published:{args.post_id}:{args.url}", text, markup)


def main(argv=None):
    try:
        sent = send_event(_build(_parser().parse_args(argv)))
        print("알림을 보냈습니다." if sent else "동일 알림이 최근 전송되어 생략했습니다.")
        return 0 if sent else 2
    except (FileNotFoundError, ValueError, KeyError) as exc:
        print(f"설정 오류: {type(exc).__name__}", file=sys.stderr); return 3
    except (TelegramAuthError, TelegramForbiddenError):
        print("텔레그램 인증 또는 권한을 확인해 주세요.", file=sys.stderr); return 4
    except TelegramTemporaryError:
        print("텔레그램 연결이 일시적으로 불안정합니다.", file=sys.stderr); return 5


if __name__ == "__main__": raise SystemExit(main())
