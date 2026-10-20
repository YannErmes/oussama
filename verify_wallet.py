#!/usr/bin/env python3
"""Diagnose the Google Wallet setup for LoyalUp.

Checks, in order:
  1. service-account.json present + readable
  2. OAuth token for the CORRECT scope (wallet_object.issuer)
  3. Issuer account visible to this service account  <-- the usual blocker
  4. Loyalty class exists + its reviewStatus
  5. Class images reachable (Google must fetch logo.png / hero.png)
  6. A sample "Add to Wallet" link, decoded for inspection

Usage:  python verify_wallet.py [ISSUER_ID]
        (ISSUER_ID defaults to the one stored in loyal.db)
"""
import base64
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.abspath(__file__))
SA_FILE = os.path.join(ROOT, "service-account.json")
DB = os.path.join(ROOT, "loyal.db")
SCOPE = "https://www.googleapis.com/auth/wallet_object.issuer"
BASE = "https://walletobjects.googleapis.com/walletobjects/v1/"
CLASS_SUFFIX = "loyalup-loyalty-class"

OK, WARN, BAD = "OK  ", "WARN", "FAIL"


def line(status, msg):
    print("[%s] %s" % (status, msg))


def default_issuer():
    if not os.path.exists(DB):
        return "3388000000023219155"
    import sqlite3
    c = sqlite3.connect(DB)
    try:
        row = c.execute("SELECT v FROM config WHERE k='issuerId' LIMIT 1").fetchone()
        return row[0] if row else "3388000000023219155"
    finally:
        c.close()


def token(sa):
    """Mint an access token using the wallet_object.issuer scope."""
    from google.auth import crypt as gcrypt
    signer = gcrypt.RSASigner.from_string(sa["private_key"], sa.get("private_key_id", ""))
    b64 = lambda x: base64.urlsafe_b64encode(x).rstrip(b"=").decode()
    now = int(time.time())
    payload = {"iss": sa["client_email"], "scope": SCOPE, "aud": sa["token_uri"],
               "exp": now + 3600, "iat": now}
    si = b64(json.dumps({"alg": "RS256", "typ": "JWT"}).encode()) + "." + b64(json.dumps(payload).encode())
    assertion = si + "." + base64.urlsafe_b64encode(signer.sign(si.encode())).rstrip(b"=").decode()
    data = urllib.parse.urlencode({"grant_type": "urn:ietf:params:oauth:grant-type:jwt-bearer",
                                   "assertion": assertion}).encode()
    req = urllib.request.Request(sa["token_uri"], data=data,
                                 headers={"Content-Type": "application/x-www-form-urlencoded"})
    r = json.load(urllib.request.urlopen(req))
    if "access_token" not in r:
        raise RuntimeError("token endpoint returned %s (scope rejected?)" % list(r.keys()))
    return r["access_token"]


def api(tok, path, method="GET", body=None):
    data = json.dumps(body).encode() if body else None
    req = urllib.request.Request(BASE + path, data=data, method=method,
                                 headers={"Authorization": "Bearer " + tok, "Content-Type": "application/json"})
    try:
        return 200, json.load(urllib.request.urlopen(req))
    except urllib.error.HTTPError as e:
        raw = e.read().decode()
        try:
            msg = json.loads(raw)["error"]["message"]
        except Exception:
            msg = raw[:200]
        return e.code, msg


def head(url):
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"}, method="GET")
        r = urllib.request.urlopen(req)
        return r.status, r.headers.get("Content-Type", ""), len(r.read())
    except urllib.error.HTTPError as e:
        return e.code, "", 0
    except Exception as e:
        return 0, str(e)[:80], 0


def main():
    issuer = sys.argv[1] if len(sys.argv) > 1 else default_issuer()
    print("LoyalUp - Google Wallet verification")
    print("Issuer ID: %s" % issuer)
    print("-" * 60)

    if not os.path.exists(SA_FILE):
        line(BAD, "service-account.json not found next to this script")
        return 1
    try:
        sa = json.load(open(SA_FILE))
    except Exception as e:
        line(BAD, "service-account.json unreadable: %s" % e)
        return 1
    line(OK, "service-account.json found (%s)" % sa.get("client_email"))

    try:
        tok = token(sa)
        line(OK, "OAuth token minted with scope %s" % SCOPE)
    except Exception as e:
        line(BAD, "could not mint token: %s" % e)
        line(WARN, "install deps:  pip install google-auth")
        return 1

    code, body = api(tok, "issuer/" + issuer)
    if code == 200:
        line(OK, "issuer %s is visible to this service account" % issuer)
        line(WARN, "issuer name: %s" % body.get("name"))
    elif code == 403:
        line(BAD, "issuer %s -> 403 Permission denied" % issuer)
        line(WARN, "FIX: Google Pay & Wallet console -> left nav 'Users' ->")
        line(WARN, "     'Invite a user' -> %s -> Access level: Developer" % sa.get("client_email"))
        line(WARN, "The JWT must be signed by a service account that is a")
        line(WARN, "member of the issuer account, otherwise the save link fails.")
    else:
        line(BAD, "issuer %s -> HTTP %s %s" % (issuer, code, body))

    code, body = api(tok, "loyaltyClass/%s.%s" % (issuer, CLASS_SUFFIX))
    if code == 200:
        line(OK, "class %s exists" % body.get("id"))
        line(WARN, "reviewStatus: %s" % body.get("reviewStatus"))
        if body.get("reviewStatus") == "DRAFT":
            line(WARN, "DRAFT classes cannot create objects - set reviewStatus")
            line(WARN, "to UNDER_REVIEW in the console (Manage tab).")
        logo = body.get("programLogo", {}).get("sourceUri", {}).get("uri", "")
        if logo:
            st, ct, ln = head(logo)
            if st == 200:
                line(OK, "programLogo reachable (%s, %d bytes)" % (ct, ln))
            else:
                line(BAD, "programLogo NOT reachable: %s -> %s" % (logo, st))
                line(WARN, "Google must fetch this image or the pass renders blank.")
        else:
            line(WARN, "class has no programLogo")
    elif code == 403:
        line(WARN, "class read blocked (same 'Users' invite fix as above)")
    else:
        line(WARN, "class %s.%s -> HTTP %s %s" % (issuer, CLASS_SUFFIX, code, body))
        line(WARN, "Not fatal: the JWT ships the class inline, so the pass")
        line(WARN, "can still be created when the user saves it.")

    site = os.environ.get("WALLET_SITE_URL", "https://loyalup-chi.vercel.app")
    for asset in ("logo.png", "hero.png"):
        u = site.rstrip("/") + "/" + asset
        st, ct, ln = head(u)
        if st == 200:
            line(OK, "%s reachable (%d bytes)" % (u, ln))
        else:
            line(WARN, "%s not reachable yet (HTTP %s)" % (u, st))
            line(WARN, "  deploy the site, or set WALLET_SITE_URL to the live URL.")

    print("-" * 60)
    print("Sample save link (open on an Android phone signed in as a test account):")
    print("  " + sample_link(sa, issuer))
    print("-" * 60)
    print("Next: open that link on your Android phone. The pass appears in the")
    print("Google Wallet app only if that Google account is a test account on")
    print("the issuer (console -> Manage -> Set up test accounts).")
    return 0


def sample_link(sa, issuer):
    from google.auth import crypt as gcrypt
    signer = gcrypt.RSASigner.from_string(sa["private_key"], sa.get("private_key_id", ""))
    b64 = lambda x: base64.urlsafe_b64encode(x).rstrip(b"=").decode()
    payload = {
        "iss": sa["client_email"], "aud": "google", "typ": "savetowallet",
        "iat": int(time.time()),
        "origins": [os.environ.get("WALLET_SITE_URL", "https://loyalup-chi.vercel.app")],
        "payload": {
            "loyaltyClasses": [{
                "id": "%s.%s" % (issuer, CLASS_SUFFIX),
                "issuerName": "LoyalUp", "reviewStatus": "UNDER_REVIEW",
                "programName": "LoyalUp",
                "programLogo": {"sourceUri": {"uri": os.environ.get("WALLET_SITE_URL", "https://loyalup-chi.vercel.app").rstrip("/") + "/logo.png"},
                                "contentDescription": {"defaultValue": {"language": "en-US", "value": "LoyalUp"}}},
            }],
            "loyaltyObjects": [{
                "id": "%s.demopass1" % issuer,
                "classId": "%s.%s" % (issuer, CLASS_SUFFIX),
                "state": "ACTIVE", "accountId": "LYL-DEMO1", "accountName": "Demo Customer",
                "barcode": {"type": "QR_CODE", "value": "LYL-DEMO1"},
                "loyaltyPoints": {"label": "Points", "balance": {"int": 0}},
            }],
        },
    }
    seg = [b64(json.dumps({"alg": "RS256", "typ": "JWT"}).encode()),
           b64(json.dumps(payload).encode())]
    sig = base64.urlsafe_b64encode(signer.sign(".".join(seg).encode())).rstrip(b"=").decode()
    return "https://pay.google.com/gp/v/save/" + ".".join(seg) + "." + sig


if __name__ == "__main__":
    sys.exit(main())
