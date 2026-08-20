import argparse
from dataclasses import asdict, dataclass
import json
from pathlib import Path
import sys

from .client import TelegramAuthError, TelegramClient, TelegramForbiddenError, TelegramTemporaryError
from .approval import ApprovalStore, UpdateOffsetStore
from .config import load_public_config
from .crypto_windows import decrypt_current_user_secret
from .events import event_from_blocker
from .messages import blocked_message, published_message, ready_message
from .locking import PollerLockError, SingleInstanceLock
from .queries import BlogQueries
from .remote import RemoteProcessor
from .revisions import RevisionStore
from .state import NotificationState
from automation.dual_publisher import (
    load_publish_manifest,
    make_instagram_publisher,
    make_youtube_publisher,
    publish_manifest,
)
from automation.instagram_uploader import InstagramClient, InstagramConfig
from automation.youtube_uploader import authorize

BASE = Path(__file__).resolve().parent
WORKSPACE_ROOT = BASE.parents[1]
APPROVAL_STORE = BASE / "approval-state.json"
UPDATE_OFFSET = BASE / "telegram-update-offset.json"
REVISION_STORE = WORKSPACE_ROOT / "automation" / "state" / "bringcare-telegram-revisions.json"


@dataclass(frozen=True)
class OutboundEvent:
    key: str
    text: str
    markup: dict | None


class _NextOffsetAdapter:
    """Present last-processed IDs to RemoteProcessor over a next-ID store."""

    def __init__(self, store: UpdateOffsetStore):
        self.store = store

    def load(self) -> int | None:
        next_id = self.store.load()
        return None if next_id is None else next_id - 1

    def save(self, last_update_id: int) -> int:
        return self.store.save(last_update_id + 1)


def send_event(event: OutboundEvent) -> bool:
    config = load_public_config(BASE / "local-config.json")
    state = NotificationState(BASE / "telegram-state.json")
    if not state.should_send(event.key): return False
    token = decrypt_current_user_secret(BASE / "token.dpapi")
    TelegramClient(token).send_message(config.chat_id, event.text, event.markup)
    state.mark_sent(event.key)
    return True


def register_pending(post_id: str, title: str, post_type: str, category: str):
    return ApprovalStore(APPROVAL_STORE).create_pending(post_id, title, post_type, category)


def load_client() -> TelegramClient:
    token = decrypt_current_user_secret(BASE / "token.dpapi")
    return TelegramClient(token, timeout=60.0)


def process_remote_once(timeout: int = 0) -> dict:
    config = load_public_config(BASE / "local-config.json")
    client = load_client()
    offsets = UpdateOffsetStore(UPDATE_OFFSET)
    next_offset = offsets.load()
    updates = client.get_updates(
        offset=next_offset,
        timeout=timeout,
    )
    processor = RemoteProcessor(
        allowed_chat_id=config.chat_id,
        approval_store=ApprovalStore(APPROVAL_STORE),
        revision_store=RevisionStore(REVISION_STORE),
        queries=BlogQueries(WORKSPACE_ROOT, approval_path=APPROVAL_STORE),
        reply=lambda chat_id, text: client.send_message(chat_id, text, None),
        update_state=_NextOffsetAdapter(offsets),
    )
    totals = {"replies": 0, "actions": 0, "approved": 0, "cancelled": 0}
    ordered = sorted(
        (
            update for update in updates
            if isinstance(update, dict)
            and isinstance(update.get("update_id"), int)
            and not isinstance(update.get("update_id"), bool)
            and update["update_id"] >= 0
        ),
        key=lambda update: update["update_id"],
    )
    for update in ordered:
        result = processor.process([update])
        for key in totals:
            totals[key] += getattr(result, key)
    return {
        "status": "ok",
        "updates": len(updates),
        **totals,
    }


def sync_approval() -> dict:
    """Compatibility entry point; RemoteProcessor is the sole update consumer."""
    return process_remote_once(timeout=0)


def run_approved_publish(
    *,
    store: ApprovalStore,
    manifest_path: Path,
    state_dir: Path,
    youtube,
    instagram,
) -> dict:
    record = store.load()
    if record is None or record.status not in {"approved", "publishing"}:
        raise RuntimeError("No approved publishing job")
    if record.status == "approved":
        record = store.claim_for_publish()
    if record is None:
        raise RuntimeError("Approval expired before publishing")
    manifest = load_publish_manifest(manifest_path)
    manifest["target"] = record.publish_target
    manifest["approval"] = {
        "approved": True,
        "approved_at": record.approved_at,
        "approved_by": "telegram-owner",
    }
    result = publish_manifest(
        manifest,
        state_dir=state_dir,
        youtube=youtube,
        instagram=instagram,
    )
    active = [
        platform
        for platform in result["platforms"].values()
        if platform["status"] != "skipped"
    ]
    if active and all(platform["status"] == "published" for platform in active):
        public_url = next(platform["url"] for platform in active if platform.get("url"))
        store.mark_published(public_url)
    return result


def _bounded_timeout(value: str) -> int:
    try:
        timeout = int(value)
    except ValueError as exc:
        raise argparse.ArgumentTypeError("timeout must be an integer") from exc
    if not 0 <= timeout <= 50:
        raise argparse.ArgumentTypeError("timeout must be between 0 and 50 seconds")
    return timeout


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
    commands.add_parser("sync-commands")
    commands.add_parser("sync-approval")
    remote_once = commands.add_parser("remote-once")
    remote_once.add_argument("--timeout", type=_bounded_timeout, default=30)
    commands.add_parser("approval-status")
    claim = commands.add_parser("claim-approved")
    claim.add_argument("--post-id", required=False)
    mark = commands.add_parser("mark-published")
    mark.add_argument("--url", required=True)
    publish = commands.add_parser("publish-approved")
    publish.add_argument("--manifest", type=Path, required=True)
    publish.add_argument("--state-dir", type=Path, default=WORKSPACE_ROOT / "automation" / "state" / "publish")
    publish.add_argument("--client-secrets", type=Path, default=WORKSPACE_ROOT / "client_secrets.json")
    publish.add_argument("--youtube-token", type=Path, default=WORKSPACE_ROOT / "automation" / "secrets" / "youtube_token.json")
    publish.add_argument("--approve-public", action="store_true")
    return parser


def _build(args):
    if args.command == "test":
        return OutboundEvent("test", "✅ <b>브링케어 텔레그램 연결 완료</b>", None)
    if args.command == "ready":
        text, markup = ready_message(args.title, args.post_type, args.category)
        return OutboundEvent(f"ready-command:{args.post_id}", text, markup)
    if args.command == "blocked":
        mapped = event_from_blocker(args.blocker, args.title, args.stage, "")
        text, markup = blocked_message(args.title, args.blocker, mapped.action, args.stage)
        return OutboundEvent(f"blocked:{args.post_id}:{args.blocker}", text, markup)
    text, markup = published_message(args.title, args.url)
    return OutboundEvent(f"published:{args.post_id}:{args.url}", text, markup)


def main(argv=None):
    try:
        args = _parser().parse_args(argv)
        if args.command in {"sync-commands", "sync-approval", "remote-once"}:
            timeout = args.timeout if args.command == "remote-once" else 0
            with SingleInstanceLock():
                result = process_remote_once(timeout=timeout)
            print(json.dumps(result, ensure_ascii=False))
            return 0
        store = ApprovalStore(APPROVAL_STORE)
        if args.command == "approval-status":
            record = store.load()
            print(json.dumps(asdict(record) if record else {"status": "none"}, ensure_ascii=False))
            return 0
        if args.command == "claim-approved":
            record = store.load()
            if args.post_id and (record is None or record.post_id != args.post_id):
                print(json.dumps({"status": "none"}))
                return 2
            claimed = store.claim_for_publish()
            print(json.dumps(asdict(claimed) if claimed else {"status": "none"}, ensure_ascii=False))
            return 0 if claimed else 2
        if args.command == "mark-published":
            record = store.mark_published(args.url)
            print(json.dumps(asdict(record), ensure_ascii=False))
            return 0
        if args.command == "publish-approved":
            credentials = authorize(args.client_secrets, args.youtube_token)
            instagram_client = InstagramClient.from_config(InstagramConfig.from_env())
            result = run_approved_publish(
                store=store,
                manifest_path=args.manifest,
                state_dir=args.state_dir,
                youtube=make_youtube_publisher(
                    credentials, approve_public=args.approve_public
                ),
                instagram=make_instagram_publisher(instagram_client),
            )
            print(json.dumps(result, ensure_ascii=False))
            return 0
        event = _build(args)
        if args.command == "ready":
            register_pending(args.post_id, args.title, args.post_type, args.category)
        sent = send_event(event)
        print("알림을 보냈습니다." if sent else "동일 알림이 최근 전송되어 생략했습니다.")
        return 0 if sent else 2
    except PollerLockError:
        print("다른 텔레그램 수신 작업이 실행 중입니다.", file=sys.stderr); return 2
    except (FileNotFoundError, ValueError, KeyError) as exc:
        print(f"설정 오류: {type(exc).__name__}", file=sys.stderr); return 3
    except (TelegramAuthError, TelegramForbiddenError):
        print("텔레그램 인증 또는 권한을 확인해 주세요.", file=sys.stderr); return 4
    except TelegramTemporaryError:
        print("텔레그램 연결이 일시적으로 불안정합니다.", file=sys.stderr); return 5


if __name__ == "__main__": raise SystemExit(main())
