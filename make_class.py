#!/usr/bin/env python3
"""Create the LoyalUp Loyalty Class in Google Wallet via the API.

Usage:  python make_class.py <ISSUER_ID> [BUSINESS_NAME]

Run once with your Issuer ID from Pay & Wallet Console -> Google Wallet API.
Then paste the printed class id into Dashboard -> Wallet integration.
"""
import json, os, sys
from google.oauth2 import service_account as gsa
from google.auth.transport.requests import Request

ROOT = os.path.dirname(os.path.abspath(__file__))
SA = os.path.join(ROOT, "service-account.json")
SCOPE = "https://www.googleapis.com/auth/cloud-platform"


def load():
    info = json.load(open(SA))
    creds = gsa.Credentials.from_service_account_info(info, scopes=[SCOPE])
    creds.refresh(Request())
    return info, creds


def call(url, method, body, token):
    import urllib.request, urllib.error
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method,
                                 headers={"Authorization": "Bearer " + token, "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req) as r:
            return json.loads(r.read().decode() or "{}")
    except urllib.error.HTTPError as e:
        detail = e.read().decode()
        try:
            detail = json.dumps(json.loads(detail).get("error", {}), indent=1)[:600]
        except Exception:
            pass
        raise SystemExit("%s %s -> HTTP %s\n%s" % (method, url, e.code, detail))


def main():
    if len(sys.argv) < 2:
        raise SystemExit("Usage: python make_class.py <ISSUER_ID> [BUSINESS_NAME]")
    issuer = sys.argv[1].strip()
    biz = (sys.argv[2] if len(sys.argv) > 2 else "LoyalUp").strip()
    info, creds = load()
    token = creds.token

    try:
        existing = call("https://walletobjects.googleapis.com/walletobjects/v1/issuerAccounts/%s/loyaltyClass?limit=100" % issuer,
                        "GET", None, token)
        for c in existing.get("loyaltyClass", []):
            print("Already exists:", c["id"])
            print("CLASS_ID=" + c["id"].split(".")[-1])
            return
    except SystemExit:
        print("(no existing class found / list unavailable, creating new)")

    payload = {
        "id": issuer + ".loyalup-loyalty-class",
        "issuerName": biz,
        "reviewStatus": "UNDER_REVIEW",
        "localizedDescription": {"description": "Visit, collect stamps and earn rewards with %s." % biz},
        "programLogo": {"sourceUri": {"uri": "https://loyalup-ma.vercel.app/logo.png"}},
        "heroImage": {"sourceUri": {"uri": "https://loyalup-ma.vercel.app/hero.png"}},
        "textModulesData": [
            {"header": "How it works", "body": {"text": "Scan the business QR to join, then show your card at every visit to collect stamps."},
             "id": "HOW"},
            {"header": "Rewards", "body": {"text": "10 stamps = 1 free reward. Extra points on special occasions like Christmas."},
             "id": "REWARDS"},
        ],
        "links": [{"uri": "https://loyalup-ma.vercel.app", "description": "Open LoyalUp"}],
    }
    out = call("https://walletobjects.googleapis.com/walletobjects/v1/loyaltyClass", "POST", payload, token)
    print("Created loyalty class:", out.get("id"))
    print("CLASS_ID=" + out.get("id", "").split(".")[-1])
    print("Issuer used:", issuer)


if __name__ == "__main__":
    main()