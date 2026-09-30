#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
BRING 업무지시서 텔레그램 발송기 (Claude Code / Codex 공용)

- 봇 토큰은 코드/저장소에 저장하지 않는다. 환경변수 TELEGRAM_BOT_TOKEN 으로 받는다.
- 수신자 chat_id 는 config.json(비밀 아님)에서 별칭으로 관리한다.
- 외부(팀원) 발송이므로, 반드시 대표 확인(컨펌) 후에만 실행한다.

사용법
  export TELEGRAM_BOT_TOKEN="123456:ABC..."
  python send_telegram.py --to hyunjin --file 결과.xlsx --caption-file msg.txt
  python send_telegram.py --to 8739295337 --file 결과.xlsx --caption "안내 문구"

의존성 없음(표준 라이브러리 urllib 사용).
"""
import os
import sys
import json
import uuid
import argparse
import mimetypes
import urllib.request


def _multipart(fields, file_field, file_path):
    boundary = "----BRING" + uuid.uuid4().hex
    nl = b"\r\n"
    body = b""
    for k, v in fields.items():
        body += b"--" + boundary.encode() + nl
        body += f'Content-Disposition: form-data; name="{k}"'.encode() + nl + nl
        body += str(v).encode("utf-8") + nl
    fname = os.path.basename(file_path)
    ctype = mimetypes.guess_type(fname)[0] or "application/octet-stream"
    with open(file_path, "rb") as fp:
        data = fp.read()
    body += b"--" + boundary.encode() + nl
    body += f'Content-Disposition: form-data; name="{file_field}"; filename="{fname}"'.encode() + nl
    body += f"Content-Type: {ctype}".encode() + nl + nl
    body += data + nl
    body += b"--" + boundary.encode() + b"--" + nl
    return body, f"multipart/form-data; boundary={boundary}"


def resolve_chat_id(to, config_path):
    if to.isdigit():
        return to
    try:
        with open(config_path, encoding="utf-8") as fp:
            cfg = json.load(fp)
        rc = cfg.get("recipients", {}).get(to)
        if rc:
            return str(rc["chat_id"])
    except FileNotFoundError:
        pass
    sys.exit(f"[오류] 수신자 '{to}' 를 config에서 찾을 수 없습니다. 별칭 또는 숫자 chat_id 를 주세요.")


def send_document(token, chat_id, file_path, caption):
    url = f"https://api.telegram.org/bot{token}/sendDocument"
    body, ctype = _multipart({"chat_id": chat_id, "caption": caption}, "document", file_path)
    req = urllib.request.Request(url, data=body, headers={"Content-Type": ctype})
    with urllib.request.urlopen(req, timeout=60) as resp:
        return json.loads(resp.read().decode("utf-8"))


def main():
    ap = argparse.ArgumentParser(description="BRING 업무지시서 텔레그램 발송")
    ap.add_argument("--to", required=True, help="수신자 별칭(config) 또는 숫자 chat_id")
    ap.add_argument("--file", required=True, help="보낼 xlsx 경로")
    ap.add_argument("--caption", help="메시지 본문")
    ap.add_argument("--caption-file", help="메시지 본문 파일(우선)")
    ap.add_argument("--config", default="config.json", help="수신자 config 경로 (기본 config.json)")
    args = ap.parse_args()

    token = os.environ.get("TELEGRAM_BOT_TOKEN")
    if not token:
        sys.exit("[오류] 환경변수 TELEGRAM_BOT_TOKEN 이 필요합니다. (예: export TELEGRAM_BOT_TOKEN=...)")

    caption = ""
    if args.caption_file:
        with open(args.caption_file, encoding="utf-8") as fp:
            caption = fp.read()
    elif args.caption:
        caption = args.caption
    caption = caption[:1024]  # 텔레그램 캡션 제한

    chat_id = resolve_chat_id(args.to, args.config)
    res = send_document(token, chat_id, args.file, caption)
    print("SENT OK" if res.get("ok") else res)


if __name__ == "__main__":
    main()
