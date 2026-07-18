#!/usr/bin/env python3
"""
Obtain a Google Ads API refresh token and store it in Vault.

Reads GOOGLE_ADS_CLIENT_ID / GOOGLE_ADS_CLIENT_SECRET from Vault
(secret/prod/growth), runs the OAuth2 installed-app flow against a local
loopback listener, then writes GOOGLE_ADS_REFRESH_TOKEN back to the same path.

Nothing secret is printed to stdout.

Usage:
    python3 growth/scripts/get-refresh-token.py

Requires: VAULT_ADDR + a valid Vault token (~/.vault-token).
"""

import http.server
import json
import os
import secrets
import subprocess
import sys
import threading
import urllib.parse
import urllib.request
import webbrowser

VAULT_PATH = "secret/prod/growth"
SCOPE = "https://www.googleapis.com/auth/adwords"
AUTH_URI = "https://accounts.google.com/o/oauth2/v2/auth"
TOKEN_URI = "https://oauth2.googleapis.com/token"
PORT = 8085
REDIRECT_URI = f"http://localhost:{PORT}/"

_result = {}


def vault(*args: str) -> str:
    env = {**os.environ, "VAULT_ADDR": os.environ.get("VAULT_ADDR", "http://127.0.0.1:8200")}
    out = subprocess.run(["vault", *args], capture_output=True, text=True, env=env)
    if out.returncode != 0:
        sys.exit(f"vault {' '.join(args[:2])} failed: {out.stderr.strip()}")
    return out.stdout


def read_credentials() -> tuple[str, str]:
    data = json.loads(vault("kv", "get", "-format=json", VAULT_PATH))["data"]["data"]
    missing = [k for k in ("GOOGLE_ADS_CLIENT_ID", "GOOGLE_ADS_CLIENT_SECRET") if k not in data]
    if missing:
        sys.exit(f"missing in Vault {VAULT_PATH}: {', '.join(missing)}")
    return data["GOOGLE_ADS_CLIENT_ID"], data["GOOGLE_ADS_CLIENT_SECRET"]


class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):  # noqa: N802
        params = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
        _result.update({k: v[0] for k, v in params.items()})
        ok = "code" in params
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.end_headers()
        msg = "Authorisation received. You can close this tab." if ok else \
              f"Authorisation failed: {params.get('error', ['unknown'])[0]}"
        self.wfile.write(f"<html><body style='font-family:sans-serif;padding:2rem'>{msg}</body></html>".encode())

    def log_message(self, *_):  # silence request logging
        pass


def main() -> None:
    client_id, client_secret = read_credentials()
    state = secrets.token_urlsafe(24)

    auth_url = AUTH_URI + "?" + urllib.parse.urlencode({
        "client_id": client_id,
        "redirect_uri": REDIRECT_URI,
        "response_type": "code",
        "scope": SCOPE,
        "access_type": "offline",     # required to receive a refresh token
        "prompt": "consent",          # force a refresh token even on re-auth
        "state": state,
    })

    server = http.server.HTTPServer(("localhost", PORT), Handler)
    threading.Thread(target=server.handle_request, daemon=True).start()

    print(f"Opening browser for consent (listening on {REDIRECT_URI}) …")
    print("If the browser does not open, visit this URL manually:\n")
    print(auth_url + "\n")
    try:
        webbrowser.open(auth_url)
    except Exception:
        pass

    server_thread_timeout = 300
    threading.Event().wait(timeout=0.1)
    waited = 0
    while "code" not in _result and "error" not in _result and waited < server_thread_timeout:
        threading.Event().wait(1)
        waited += 1

    if "error" in _result:
        sys.exit(f"authorisation denied: {_result['error']}")
    if "code" not in _result:
        sys.exit("timed out waiting for authorisation")
    if _result.get("state") != state:
        sys.exit("state mismatch — aborting")

    body = urllib.parse.urlencode({
        "code": _result["code"],
        "client_id": client_id,
        "client_secret": client_secret,
        "redirect_uri": REDIRECT_URI,
        "grant_type": "authorization_code",
    }).encode()

    req = urllib.request.Request(TOKEN_URI, data=body,
                                 headers={"Content-Type": "application/x-www-form-urlencoded"})
    try:
        with urllib.request.urlopen(req) as resp:
            tokens = json.load(resp)
    except urllib.error.HTTPError as e:
        sys.exit(f"token exchange failed ({e.code}): {e.read().decode()[:300]}")

    refresh = tokens.get("refresh_token")
    if not refresh:
        sys.exit("no refresh_token returned — revoke prior access and retry with prompt=consent")

    vault("kv", "patch", VAULT_PATH, f"GOOGLE_ADS_REFRESH_TOKEN={refresh}")
    print(f"\nrefresh token stored in Vault at {VAULT_PATH} (length {len(refresh)})")
    print("Nothing secret was printed. Run verify-api-access.py next.")


if __name__ == "__main__":
    main()
