from http.server import BaseHTTPRequestHandler, HTTPServer
import json
import os
import time


def _compact(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def _payload_value(payload, *paths):
    for path in paths:
        cur = payload
        ok = True
        for key in path:
            if isinstance(cur, dict) and key in cur:
                cur = cur[key]
            else:
                ok = False
                break
        if ok and cur not in (None, ""):
            return cur
    return None


class Handler(BaseHTTPRequestHandler):
    def _send_json(self, status, payload):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/health":
            self._send_json(200, {"ok": True, "service": "sub2api-wechat-poc-webhook"})
            return
        self._send_json(404, {"ok": False, "error": "not_found"})

    def do_POST(self):
        expected_token = os.environ.get("POC_WEBHOOK_TOKEN", "")
        if expected_token:
            expected = f"Bearer {expected_token}"
            if self.headers.get("Authorization") != expected:
                self._send_json(401, {"ok": False, "error": "unauthorized"})
                return

        length = int(self.headers.get("Content-Length", "0"))
        raw = self.rfile.read(length)
        try:
            payload = json.loads(raw.decode("utf-8") or "{}")
        except json.JSONDecodeError:
            self._send_json(400, {"ok": False, "error": "invalid_json"})
            return

        print(_compact({"ts": int(time.time()), "path": self.path, "payload": payload}), flush=True)

        if payload.get("type") == "url_verification":
            self._send_json(200, {"challenge": payload.get("challenge")})
            return

        content = (_payload_value(payload, ("content",), ("text",), ("event", "data", "content"), ("event", "data", "text")) or "").strip()
        sender = _payload_value(payload, ("sender",), ("event", "data", "sender")) or {}
        session_id = _payload_value(payload, ("sessionID",), ("session_id",), ("event", "data", "sessionID"))
        channel_id = _payload_value(payload, ("channel_id",), ("channelID",), ("event", "channel_id"))
        group = _payload_value(payload, ("group",), ("room",), ("event", "data", "group"), ("event", "data", "room"))

        if content.startswith("/ping") or content == "ping":
            self._send_json(200, {"reply": "pong: sub2api wechat POC webhook is alive"})
            return

        if content.startswith("/status") or "状态" in content:
            group_name = "plus" if "plus" in content.lower() else "all"
            self._send_json(
                200,
                {
                    "reply": (
                        f"POC status group={group_name}: total=3 active=2 disabled=1. "
                        "This is mock data; WeChat event delivery is working."
                    )
                },
            )
            return

        if content.startswith("/add-plus-dry-run") or "加号" in content:
            self._send_json(
                200,
                {
                    "reply": (
                        "dry-run accepted: job=poc_plus_import_001, group=plus, "
                        "no real CDK was redeemed."
                    )
                },
            )
            return

        scope = "group" if group else "dm_or_unknown"
        sender_id = sender.get("user_id") or sender.get("id") or "unknown"
        group_id = None
        if isinstance(group, dict):
            group_id = group.get("id") or group.get("room_id") or group.get("user_id")
        self._send_json(
            200,
            {
                "reply": (
                    f"received {scope} message. sender={sender_id}"
                    + (f" group={group_id}" if group_id else "")
                    + (f" session={session_id}" if session_id else "")
                    + (f" channel={channel_id}" if channel_id else "")
                    + ". Try /ping, /status plus, or /add-plus-dry-run."
                )
            },
        )


if __name__ == "__main__":
    bind = os.environ.get("POC_WEBHOOK_BIND", "127.0.0.1")
    port = int(os.environ.get("POC_WEBHOOK_PORT", "9811"))
    HTTPServer((bind, port), Handler).serve_forever()
