#!/usr/bin/env python3
"""
Verify Google Ads API access with a real call.

Reads credentials from Vault (secret/prod/growth), exchanges the refresh token
for an access token, then calls listAccessibleCustomers.

This is the empirical check that the access level shown in the Google Ads UI
is actually usable. Prints no secrets.

Usage:
    python3 growth/scripts/verify-api-access.py
"""

import json
import os
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request

VAULT_PATH = "secret/prod/growth"
TOKEN_URI = "https://oauth2.googleapis.com/token"
API_VERSION = "v21"

REQUIRED = (
    "GOOGLE_ADS_CLIENT_ID",
    "GOOGLE_ADS_CLIENT_SECRET",
    "GOOGLE_ADS_REFRESH_TOKEN",
    "GOOGLE_ADS_DEVELOPER_TOKEN",
)


def vault_read() -> dict:
    env = {**os.environ, "VAULT_ADDR": os.environ.get("VAULT_ADDR", "http://127.0.0.1:8200")}
    out = subprocess.run(["vault", "kv", "get", "-format=json", VAULT_PATH],
                         capture_output=True, text=True, env=env)
    if out.returncode != 0:
        sys.exit(f"vault read failed: {out.stderr.strip()}")
    return json.loads(out.stdout)["data"]["data"]


def access_token(cfg: dict) -> str:
    body = urllib.parse.urlencode({
        "client_id": cfg["GOOGLE_ADS_CLIENT_ID"],
        "client_secret": cfg["GOOGLE_ADS_CLIENT_SECRET"],
        "refresh_token": cfg["GOOGLE_ADS_REFRESH_TOKEN"],
        "grant_type": "refresh_token",
    }).encode()
    req = urllib.request.Request(TOKEN_URI, data=body,
                                 headers={"Content-Type": "application/x-www-form-urlencoded"})
    try:
        with urllib.request.urlopen(req) as resp:
            return json.load(resp)["access_token"]
    except urllib.error.HTTPError as e:
        detail = e.read().decode()[:300]
        if "invalid_grant" in detail:
            sys.exit("refresh token rejected (invalid_grant).\n"
                     "In 'Testing' publishing status refresh tokens expire after 7 days — "
                     "re-run get-refresh-token.py, or publish the app for non-expiring tokens.")
        sys.exit(f"token refresh failed ({e.code}): {detail}")


def main() -> None:
    cfg = vault_read()
    missing = [k for k in REQUIRED if k not in cfg]
    if missing:
        sys.exit(f"missing in Vault {VAULT_PATH}: {', '.join(missing)}\n"
                 "Run get-refresh-token.py first.")

    token = access_token(cfg)
    url = f"https://googleads.googleapis.com/{API_VERSION}/customers:listAccessibleCustomers"
    req = urllib.request.Request(url, headers={
        "Authorization": f"Bearer {token}",
        "developer-token": cfg["GOOGLE_ADS_DEVELOPER_TOKEN"],
    })

    try:
        with urllib.request.urlopen(req) as resp:
            data = json.load(resp)
            status = resp.status
    except urllib.error.HTTPError as e:
        detail = e.read().decode()
        print(f"HTTP {e.code}")
        try:
            err = json.loads(detail)["error"]
            print(f"  status:  {err.get('status')}")
            print(f"  message: {err.get('message')}")
            for d in err.get("details", []):
                for sub in d.get("errors", []):
                    print(f"  error:   {json.dumps(sub.get('errorCode', {}))}")
        except Exception:
            print(detail[:600])
        sys.exit(1)

    names = data.get("resourceNames", [])
    print(f"HTTP {status} — API access confirmed\n")
    print(f"accessible customers: {len(names)}")
    for n in names:
        print(f"  {n}")
    print(f"\napi version: {API_VERSION}")
    print("developer token and OAuth credentials are valid.")


if __name__ == "__main__":
    main()
