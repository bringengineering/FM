from __future__ import annotations

import argparse
import json
import mimetypes
from datetime import date
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

from . import __version__
from .config import Settings
from .domain import build_kpi_report, qc_summary
from .seed import seed_demo
from .store import OpsStore
from .youtube_live import audit_oauth_file, fetch_youtube_feed

WEB_ROOT = Path(__file__).with_name("web")


def health_payload():
    return {"status": "ok", "service": "BRING Marketing OS", "version": __version__}


def make_payload(store):
    metrics = store.metrics()
    latest = metrics[-1] if metrics else {"subscribers": 0}
    kpi = build_kpi_report(latest["subscribers"], 1_000_000, 100, 0)
    jobs, checks = store.jobs(), store.qc()
    qcs = qc_summary([{"name": c["name"], "passed": bool(c["passed"]), "critical": bool(c["critical"])} for c in checks])
    return {"mode": "DEMO", "as_of": date.today().isoformat(), "kpi": kpi,
            "topics": store.topics(5), "jobs": jobs, "qc": qcs,
            "alerts": store.alerts(), "today_actions": [
                "음량 미달 1편을 보정한 뒤 QC 재실행",
                "근거 3개 이상 확보된 TOP3의 훅 A/B 확정",
                "첫 3초 유지율 데이터가 생길 때까지 하루 5편을 서로 다른 훅으로 실험",
            ]}


def create_server(host, port, db_path, seed=False, youtube_channel_id="UCQLXXp7f5kI9KMox8xcSeZA", youtube_token_path=None):
    Path(db_path).parent.mkdir(parents=True, exist_ok=True)
    store = OpsStore(db_path)
    store.initialize()
    if seed:
        seed_demo(store)

    class Handler(BaseHTTPRequestHandler):
        def send_json(self, value, status=200):
            data = json.dumps(value, ensure_ascii=False).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def do_GET(self):
            path = urlparse(self.path).path
            if path == "/api/health":
                self.send_json(health_payload()); return
            if path == "/api/dashboard":
                self.send_json(make_payload(store)); return
            if path == "/api/topics":
                self.send_json({"mode": "DEMO", "items": store.topics(20)}); return
            if path == "/api/jobs":
                self.send_json({"items": store.jobs()}); return
            if path == "/api/qc":
                self.send_json({"items": store.qc()}); return
            if path == "/api/blog":
                payload = store.blog_workspace()
                payload["mode"] = "DEMO"
                self.send_json(payload); return
            if path == "/api/competitors":
                self.send_json({"mode": "DEMO", "items": store.competitors()}); return
            if path == "/api/youtube-live":
                token_path = Path(youtube_token_path) if youtube_token_path else Path("__not_configured__")
                try:
                    feed = fetch_youtube_feed(youtube_channel_id)
                    self.send_json({"feed": feed, "oauth": audit_oauth_file(token_path)})
                except Exception as exc:
                    self.send_json({"feed": {"source_mode": "ERROR", "videos": [], "error": type(exc).__name__},
                                    "oauth": audit_oauth_file(token_path)}, 200)
                return
            if path == "/api/report":
                payload = make_payload(store)
                self.send_json({"kpi": payload["kpi"], "today_actions": payload["today_actions"],
                                "principle": "조회수 하나가 아니라 훅·완주·공유·전환·비용을 함께 판단"}); return
            target = WEB_ROOT / ("index.html" if path == "/" else path.lstrip("/"))
            try:
                resolved = target.resolve()
                if WEB_ROOT.resolve() not in resolved.parents and resolved != WEB_ROOT.resolve():
                    raise FileNotFoundError
                data = resolved.read_bytes()
            except (FileNotFoundError, IsADirectoryError):
                self.send_error(404); return
            self.send_response(200)
            self.send_header("Content-Type", mimetypes.guess_type(str(resolved))[0] or "application/octet-stream")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers(); self.wfile.write(data)

        def do_POST(self):
            path = urlparse(self.path).path
            if path.startswith("/api/jobs/") and path.endswith("/resume"):
                try:
                    job_id = int(path.split("/")[3])
                    self.send_json(store.resume_job(job_id))
                except (ValueError, IndexError) as exc:
                    self.send_json({"error": str(exc)}, 400)
                return
            self.send_json({"error": "not found"}, 404)

        def log_message(self, fmt, *args):
            pass

    server = ThreadingHTTPServer((host, port), Handler)
    server.store = store
    return server


def main():
    settings = Settings.from_env()
    parser = argparse.ArgumentParser(description="BRING Marketing OS")
    parser.add_argument("--host", default=settings.host)
    parser.add_argument("--port", type=int, default=settings.port)
    parser.add_argument("--db", default=str(settings.db_path))
    parser.add_argument("--seed", action="store_true")
    args = parser.parse_args()
    server = create_server(args.host, args.port, args.db, args.seed,
                           settings.youtube_channel_id, settings.youtube_token_path)
    print(f"BRING Marketing OS: http://{args.host}:{server.server_port}")
    server.serve_forever()


if __name__ == "__main__":
    main()
