#!/usr/bin/env python3
"""LoyalUp backend — ZERO installs (stdlib only). Multi-business platform.

Each business: registers (name + password) -> gets own dashboard + own QR code.
Customers scan THAT business's QR -> join page -> fidelity QR + wallet pass.

Run:  python server.py   ->  http://127.0.0.1:8000/

Pages: / (landing)  /login.html (business login)  /dashboard.html (guarded)
       /join.html?b=BUSINESS_ID (customer join page - this is what the business QR encodes)

Auth: POST /api/auth/signup {businessName,password} -> {token,business}
      POST /api/auth/login  {businessName,password} -> {token,business}
      (login auto-creates an unknown business so testing "just works";
       wrong password for an existing business is rejected)
      All other /api/* need header:  Authorization: Bearer <token>

GOOGLE WALLET GO-LIVE: pip install google-auth + drop service-account.json here
 + set Issuer ID in Dashboard -> Wallet integration.
"""
import json, sqlite3, os, time, base64, random, string, datetime, hashlib, secrets
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from urllib.parse import urlparse, parse_qs

ROOT = os.path.dirname(os.path.abspath(__file__))
DB = os.path.join(ROOT, "loyal.db")
SA_FILE = os.path.join(ROOT, "service-account.json")
PORT = 8000

# ---------------- helpers ----------------
def db():
    c = sqlite3.connect(DB)
    c.row_factory = sqlite3.Row
    return c

def now_iso():
    return datetime.datetime.now().isoformat(timespec="seconds")

def new_id(prefix="LYL"):
    r = "".join(random.choices(string.ascii_uppercase + string.digits, k=4))
    t = format(int(time.time() * 1000) % 46656, "04X")[-4:]
    return "%s-%s%s" % (prefix, r, t)

def new_biz_id():
    return "BIZ-" + "".join(random.choices(string.ascii_uppercase + string.digits, k=6))

def hash_pw(pw, salt=None):
    salt = salt or secrets.token_hex(16)
    h = hashlib.pbkdf2_hmac("sha256", pw.encode(), salt.encode(), 120000).hex()
    return "%s$%s" % (salt, h)

def check_pw(pw, stored):
    try:
        salt, h = stored.split("$", 1)
        return hash_pw(pw, salt) == stored
    except Exception:
        return False

def cols(c, table):
    return [r["name"] for r in c.execute("PRAGMA table_info(%s)" % table).fetchall()]

def ensure_col(c, table, col, ddl):
    if col not in cols(c, table):
        c.execute("ALTER TABLE %s ADD COLUMN %s %s" % (table, col, ddl))

# ---------------- DB ----------------
def init_db():
    c = db(); e = c.execute
    e("""CREATE TABLE IF NOT EXISTS businesses(id TEXT PRIMARY KEY, name TEXT UNIQUE,
         pw TEXT, city TEXT DEFAULT '', size TEXT DEFAULT '', btype TEXT DEFAULT '',
         lat REAL DEFAULT 0, lng REAL DEFAULT 0, loc_label TEXT DEFAULT '', createdAt TEXT)""")
    e("""CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY, businessId TEXT, createdAt TEXT)""")
    e("""CREATE TABLE IF NOT EXISTS members(id TEXT PRIMARY KEY, businessId TEXT, name TEXT,
         phone TEXT DEFAULT '', visits INT DEFAULT 0, stamps INT DEFAULT 0, points INT DEFAULT 0,
         streak INT DEFAULT 0, lastVisit TEXT, walletAdded INT DEFAULT 0,
         walletObjectId TEXT DEFAULT '', createdAt TEXT)""")
    e("""CREATE TABLE IF NOT EXISTS messages(id INTEGER PRIMARY KEY AUTOINCREMENT,
         memberId TEXT, text TEXT, createdAt TEXT)""")
    e("""CREATE TABLE IF NOT EXISTS rewards(id TEXT PRIMARY KEY, businessId TEXT, name TEXT,
         cost INT, active INT DEFAULT 1)""")
    e("""CREATE TABLE IF NOT EXISTS promos(id TEXT PRIMARY KEY, businessId TEXT, text TEXT, createdAt TEXT)""")
    e("""CREATE TABLE IF NOT EXISTS activity(id INTEGER PRIMARY KEY AUTOINCREMENT,
         businessId TEXT, line TEXT, createdAt TEXT)""")
    e("""CREATE TABLE IF NOT EXISTS config(businessId TEXT, k TEXT, v TEXT,
         PRIMARY KEY(businessId, k))""")
    for t in ("members", "rewards", "promos", "activity"):
        ensure_col(c, t, "businessId", "TEXT DEFAULT ''")
    for col, ddl in [("city", "TEXT DEFAULT ''"), ("size", "TEXT DEFAULT ''"),
                     ("btype", "TEXT DEFAULT ''"), ("lat", "REAL DEFAULT 0"),
                     ("lng", "REAL DEFAULT 0"), ("loc_label", "TEXT DEFAULT ''")]:
        ensure_col(c, "businesses", col, ddl)
    # migrate legacy config(k,v) -> config(businessId,k,v)
    if "businessId" not in cols(c, "config"):
        try:
            old = c.execute("SELECT k,v FROM config").fetchall()
        except Exception:
            old = []
        c.execute("DROP TABLE config")
        c.execute("CREATE TABLE config(businessId TEXT, k TEXT, v TEXT, PRIMARY KEY(businessId,k))")
        biz = get_or_create_business(c, "LoyalUp Demo Store", None, silent=True)
        for r in old:
            c.execute("INSERT OR IGNORE INTO config VALUES(?,?,?)", (biz["id"], r["k"], r["v"]))
        for t in ("members", "rewards", "promos", "activity"):
            c.execute("UPDATE %s SET businessId=? WHERE businessId='' OR businessId IS NULL" % t, (biz["id"],))
    c.commit()
    # seed demo business content if totally empty
    if not e("SELECT 1 FROM businesses LIMIT 1").fetchone():
        biz = get_or_create_business(c, "LoyalUp Demo Store", None, silent=True)
        seed_business(c, biz["id"])
        c.commit()
    c.close()

def biz_public(row):
    return {"id": row["id"], "name": row["name"], "city": row["city"] if "city" in row.keys() else "",
            "size": row["size"] if "size" in row.keys() else "",
            "btype": row["btype"] if "btype" in row.keys() else "",
            "lat": row["lat"] if "lat" in row.keys() else 0,
            "lng": row["lng"] if "lng" in row.keys() else 0,
            "loc_label": row["loc_label"] if "loc_label" in row.keys() else ""}

def get_or_create_business(c, name, pw, profile=None, silent=False):
    name = (name or "").strip() or "My Business"
    profile = profile or {}
    row = c.execute("SELECT * FROM businesses WHERE LOWER(name)=LOWER(?)", (name,)).fetchone()
    if row:
        # fill empty profile fields on re-login when provided
        ups = {k: str(profile.get(k, "") or "") for k in ("city", "size", "btype", "loc_label")}
        try:
            if profile.get("lat") or profile.get("lng"):
                ups["lat"] = float(profile.get("lat") or 0); ups["lng"] = float(profile.get("lng") or 0)
        except Exception:
            pass
        for k, v in ups.items():
            if v and not (row[k] if k in row.keys() else ""):
                c.execute("UPDATE businesses SET %s=? WHERE id=?" % k, (v, row["id"]))
        c.commit()
        row = c.execute("SELECT * FROM businesses WHERE id=?", (row["id"],)).fetchone()
        return biz_public(row)
    bid = new_biz_id()
    c.execute("""INSERT INTO businesses(id,name,pw,city,size,btype,lat,lng,loc_label,createdAt)
                 VALUES(?,?,?,?,?,?,?,?,?,?)""",
              (bid, name, hash_pw(pw) if pw else "", str(profile.get("city", "") or ""),
               str(profile.get("size", "") or ""), str(profile.get("btype", "") or ""),
               float(profile.get("lat") or 0), float(profile.get("lng") or 0),
               str(profile.get("loc_label", "") or ""), now_iso()))
    c.execute("INSERT OR IGNORE INTO config VALUES(?,?,?)", (bid, "business", name))
    c.execute("INSERT OR IGNORE INTO config VALUES(?,?,?)", (bid, "issuerId", ""))
    c.execute("INSERT OR IGNORE INTO config VALUES(?,?,?)", (bid, "classId", "loyalup-loyalty-class"))
    c.commit()
    if not silent:
        log(c, bid, "Business registered: %s" % name)
    return biz_public(c.execute("SELECT * FROM businesses WHERE id=?", (bid,)).fetchone())

def seed_business(c, bid):
    for name, visits, stamps, points, streak in [
            ("Salma B.", 8, 8, 90, 6), ("Rihab", 5, 5, 50, 3), ("Yassine", 9, 9, 110, 7)]:
        mid = new_id()
        c.execute("""INSERT INTO members(id,businessId,name,visits,stamps,points,streak,lastVisit,walletAdded,createdAt)
                     VALUES(?,?,?,?,?,?,?,?,?,?)""",
                  (mid, bid, name, visits, stamps, points, streak, now_iso(), 0, now_iso()))
        c.execute("INSERT INTO messages(memberId,text,createdAt) VALUES(?,?,?)",
                  (mid, "Welcome to LoyalUp! Show your QR at the store.", now_iso()))
    for rid, nm, cost in [("r1", "Free coffee", 10), ("r2", "-20% soin", 8)]:
        c.execute("INSERT OR IGNORE INTO rewards VALUES(?,?,?,?,?)", (rid, bid, nm, cost, 1))
    c.execute("INSERT OR IGNORE INTO promos VALUES(?,?,?,?)",
              ("p1", bid, "Welcome! -10% on your next visit", now_iso()))

def log(c_or_bid, bid_or_line, line=None):
    try:
        if line is None:
            c, bid, txt = db(), c_or_bid, bid_or_line
            close = True
        else:
            c, bid, txt, close = c_or_bid, bid_or_line, line, False
        c.execute("INSERT INTO activity(businessId,line,createdAt) VALUES(?,?,?)",
                  (bid, txt, datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")))
        c.execute("""DELETE FROM activity WHERE id NOT IN
                     (SELECT id FROM activity WHERE businessId=? ORDER BY id DESC LIMIT 200)""", (bid,))
        c.commit()
        if close:
            c.close()
    except Exception:
        pass

def get_config(bid):
    c = db()
    rows = c.execute("SELECT k,v FROM config WHERE businessId=?", (bid,)).fetchall(); c.close()
    d = {r["k"]: r["v"] for r in rows}
    d.setdefault("business", ""); d.setdefault("issuerId", ""); d.setdefault("classId", "loyalup-loyalty-class")
    return d

def member_with_messages(c, row):
    msgs = [r["text"] for r in c.execute(
        "SELECT text FROM messages WHERE memberId=? ORDER BY id", (row["id"],)).fetchall()]
    return {"id": row["id"], "name": row["name"], "phone": row["phone"] or "",
            "visits": row["visits"], "stamps": row["stamps"], "points": row["points"],
            "streak": row["streak"], "lastVisit": row["lastVisit"],
            "walletAdded": bool(row["walletAdded"]), "messages": msgs}

def full_state(bid):
    c = db()
    members = [member_with_messages(c, r) for r in c.execute(
        "SELECT * FROM members WHERE businessId=? ORDER BY createdAt", (bid,)).fetchall()]
    promos = [{"id": r["id"], "text": r["text"], "date": r["createdAt"]} for r in
              c.execute("SELECT * FROM promos WHERE businessId=? ORDER BY createdAt", (bid,)).fetchall()]
    rewards = [{"id": r["id"], "name": r["name"], "cost": r["cost"], "active": bool(r["active"])} for r in
               c.execute("SELECT * FROM rewards WHERE businessId=?", (bid,)).fetchall()]
    lines = [r["createdAt"] + "  " + r["line"] for r in c.execute(
        "SELECT * FROM activity WHERE businessId=? ORDER BY id DESC LIMIT 200", (bid,)).fetchall()]
    c.close()
    return {"members": members, "promos": promos, "rewards": rewards,
            "config": get_config(bid), "log": lines}

# ---------------- loyalty rules (mirror of js/loyalty.js) ----------------
def occasion_bonus(dt):
    out = []
    if (dt.month == 12 and dt.day >= 20) or (dt.month == 1 and dt.day <= 7):
        out.append({"name": "Christmas / New Year x2 stamps", "points": 20, "stamps": 1})
    if dt.weekday() >= 5:
        out.append({"name": "Weekend +10 pts", "points": 10, "stamps": 0})
    return out

def do_scan(bid, member_id, force=False):
    c = db()
    row = c.execute("SELECT * FROM members WHERE id=? AND businessId=?", (member_id, bid)).fetchone()
    if not row:
        c.close(); return {"error": "Unknown code for this business. Customer must join with YOUR QR."}
    today = datetime.date.today().isoformat()
    if row["lastVisit"] and row["lastVisit"][:10] == today and not force:
        m = member_with_messages(c, row); c.close()
        return {"error": "Already scanned today — streak protected (1 stamp / day).", "member": m}
    now = datetime.datetime.now()
    bonuses = occasion_bonus(now)
    pts, stamps = 10, 1
    for b in bonuses:
        pts += b["points"]; stamps += b["stamps"]
    if (row["streak"] or 0) >= 4:
        pts += 20; bonuses.append({"name": "Streak bonus +20 pts", "points": 20, "stamps": 0})
    visits, nstamps, npoints, streak = row["visits"] + 1, row["stamps"] + stamps, row["points"] + pts, row["streak"] + 1
    reward = None
    if nstamps >= 10:
        nstamps -= 10; reward = "Reward unlocked (free item)"
        c.execute("INSERT INTO messages(memberId,text,createdAt) VALUES(?,?,?)",
                  (member_id, "Récompense débloquée — show this to claim your reward!", now_iso()))
    c.execute("UPDATE members SET visits=?,stamps=?,points=?,streak=?,lastVisit=? WHERE id=?",
              (visits, nstamps, npoints, streak, now_iso(), member_id))
    c.execute("INSERT INTO messages(memberId,text,createdAt) VALUES(?,?,?)",
              (member_id, "+1 tampon — Visite validée (%d)" % visits, now_iso()))
    c.commit()
    row = c.execute("SELECT * FROM members WHERE id=?", (member_id,)).fetchone()
    m = member_with_messages(c, row)
    log(c, bid, "SCAN %s +%dpts, streak %d" % (m["name"], pts, streak))
    c.close()
    return {"member": m, "points": pts, "bonuses": bonuses, "reward": reward}

# ---------------- Google Wallet JWT ----------------
def demo_save_url(member_id):
    raw = json.dumps({"iss": "demo@loyalup", "member": member_id}).encode()
    jwt = "DEMO." + base64.urlsafe_b64encode(raw).rstrip(b"=").decode() + ".SIGN_WITH_BACKEND"
    return "https://pay.google.com/gp/v/save/" + jwt

def wallet_save_url(bid, member_id):
    cfg = get_config(bid)
    if os.path.exists(SA_FILE):
        try:
            from google.auth import crypt as gcrypt
            sa = json.load(open(SA_FILE))
            signer = gcrypt.RSASigner.from_string(sa["private_key"], sa.get("private_key_id", ""))
            payload = {"iss": sa["client_email"], "aud": "google",
                       "typ": "savetowallet", "iat": int(time.time()),
                       "payload": {"loyaltyObjects": [{
                           "id": "%s.%s" % (cfg.get("issuerId", ""), member_id.replace("-", "").lower()[:20]),
                           "classId": "%s.%s" % (cfg.get("issuerId", ""), cfg.get("classId", "")),
                           "state": "active", "accountId": member_id,
                           "accountName": member_id, "barcode": {"type": "qrCode", "value": member_id}}]}}
            seg = [base64.urlsafe_b64encode(json.dumps({"alg": "RS256", "typ": "JWT"}).encode()).rstrip(b"=").decode(),
                   base64.urlsafe_b64encode(json.dumps(payload).encode()).rstrip(b"=").decode()]
            sig = signer.sign(".".join(seg).encode())
            return {"saveUrl": "https://pay.google.com/gp/v/save/" + ".".join(seg) + "." +
                    base64.urlsafe_b64encode(sig).rstrip(b"=").decode(), "mode": "live"}
        except Exception as ex:
            return {"saveUrl": demo_save_url(member_id), "mode": "demo-need-libs",
                    "hint": "pip install google-auth, then retry. (%s)" % ex}
    return {"saveUrl": demo_save_url(member_id), "mode": "demo",
            "hint": "Add service-account.json + Issuer ID to go live."}

# ---------------- HTTP ----------------
class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=ROOT, **k)

    def _json(self, obj, code=200):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _body(self):
        n = int(self.headers.get("Content-Length") or 0)
        try:
            return json.loads(self.rfile.read(n).decode() or "{}")
        except Exception:
            return {}

    def _auth(self):
        h = self.headers.get("Authorization") or ""
        tok = h[7:] if h.startswith("Bearer ") else ""
        if not tok:
            return None
        c = db()
        s = c.execute("SELECT businessId FROM sessions WHERE token=?", (tok,)).fetchone()
        if not s:
            c.close(); return None
        b = c.execute("SELECT * FROM businesses WHERE id=?", (s["businessId"],)).fetchone()
        c.close()
        return biz_public(b) if b else None

    def do_GET(self):
        u = urlparse(self.path)
        if u.path == "/api/health":
            c = db()
            nb = c.execute("SELECT COUNT(*) v FROM businesses").fetchone()["v"]
            nm = c.execute("SELECT COUNT(*) v FROM members").fetchone()["v"]
            c.close()
            return self._json({"ok": True, "walletMode": "live-ready" if os.path.exists(SA_FILE) else "demo",
                               "businesses": nb, "members": nm, "db": "loyal.db"})
        if u.path == "/api/public/business":
            bid = parse_qs(u.query).get("b", [""])[0]
            c = db()
            b = c.execute("SELECT id,name FROM businesses WHERE id=?", (bid,)).fetchone(); c.close()
            if not b:
                return self._json({"error": "Unknown business QR."}, 404)
            cfg = get_config(bid)
            return self._json({"businessId": b["id"], "businessName": cfg.get("business") or b["name"]})
        if u.path == "/api/bootstrap":
            me = self._auth()
            if not me:
                return self._json({"error": "login required"}, 401)
            st = full_state(me["id"]); st["business"] = me
            return self._json(st)
        if u.path == "/api/activity":
            me = self._auth()
            if not me:
                return self._json({"error": "login required"}, 401)
            return self._json({"lines": full_state(me["id"])["log"]})
        if u.path == "/api/wallet/jwt":
            me = self._auth()
            if not me:
                return self._json({"error": "login required"}, 401)
            return self._json(wallet_save_url(me["id"], parse_qs(u.query).get("member", [""])[0]))
        if u.path == "/api/public/wallet/jwt":
            # Customer adding THEIR pass (from join page): verify member belongs to business.
            qs = parse_qs(u.query)
            bid, mid = qs.get("b", [""])[0], qs.get("member", [""])[0]
            c = db()
            ok = c.execute("SELECT 1 FROM members WHERE id=? AND businessId=?", (mid, bid)).fetchone()
            c.close()
            if not ok:
                return self._json({"error": "Unknown card."}, 404)
            return self._json(wallet_save_url(bid, mid))
        return super().do_GET()

    def do_POST(self):
        u = urlparse(self.path); d = self._body()
        if u.path in ("/api/auth/signup", "/api/auth/login"):
            name = (d.get("businessName") or "").strip()
            pw = d.get("password") or ""
            profile = d.get("profile") or {}
            if not name or not pw:
                return self._json({"error": "Business name + password required."}, 400)
            c = db()
            row = c.execute("SELECT * FROM businesses WHERE LOWER(name)=LOWER(?)", (name,)).fetchone()
            if u.path == "/api/auth/signup":
                if row:
                    c.close(); return self._json({"error": "Name taken — log in instead."}, 409)
                biz = get_or_create_business(c, name, pw, profile)
                seed_business(c, biz["id"]); c.commit()
            else:  # login: auto-create unknown business so testing just works
                if row and row["pw"] and not check_pw(pw, row["pw"]):
                    c.close(); return self._json({"error": "Wrong password for this business."}, 403)
                biz = get_or_create_business(c, name, pw if not row else None, profile if not row else profile)
                if not row:
                    seed_business(c, biz["id"]); c.commit()
                    log(biz["id"], "Business auto-registered on first login: %s" % name)
            tok = secrets.token_urlsafe(32)
            c.execute("INSERT INTO sessions VALUES(?,?,?)", (tok, biz["id"], now_iso()))
            c.commit(); c.close()
            return self._json({"token": tok, "business": biz})
        me = self._auth()
        if not me:
            if u.path == "/api/public/join":
                # Customer joining via business QR (no login needed).
                bid = (d.get("b") or "").strip()
                name = (d.get("name") or "").strip() or "Guest"
                c = db()
                if not c.execute("SELECT 1 FROM businesses WHERE id=?", (bid,)).fetchone():
                    c.close(); return self._json({"error": "Unknown business QR."}, 404)
                mid = d.get("memberId") or new_id()
                if not c.execute("SELECT 1 FROM members WHERE id=?", (mid,)).fetchone():
                    c.execute("""INSERT INTO members(id,businessId,name,visits,stamps,points,streak,lastVisit,walletAdded,createdAt)
                                 VALUES(?,?,?,?,?,?,?,?,?,?)""",
                              (mid, bid, name, 0, 0, 0, 0, None, 0, now_iso()))
                    c.execute("INSERT INTO messages(memberId,text,createdAt) VALUES(?,?,?)",
                              (mid, "Welcome to LoyalUp! Show your QR at the store.", now_iso()))
                    c.commit()
                    log(c, bid, "JOIN %s (%s) via QR" % (name, mid))
                c.close()
                return self._json({"memberId": mid})
            return self._json({"error": "login required"}, 401)
        bid = me["id"]
        if u.path == "/api/sync":
            c = db()
            for m in d.get("members", []):
                c.execute("""INSERT INTO members(id,businessId,name,phone,visits,stamps,points,streak,lastVisit,walletAdded,createdAt)
                             VALUES(?,?,?,?,?,?,?,?,?,?,?)
                             ON CONFLICT(id) DO UPDATE SET name=excluded.name,phone=excluded.phone,
                             visits=excluded.visits,stamps=excluded.stamps,points=excluded.points,
                             streak=excluded.streak,lastVisit=excluded.lastVisit,walletAdded=excluded.walletAdded""",
                          (m.get("id"), bid, m.get("name"), m.get("phone", ""), m.get("visits", 0),
                           m.get("stamps", 0), m.get("points", 0), m.get("streak", 0),
                           m.get("lastVisit"), 1 if m.get("walletAdded") else 0, now_iso()))
                for t in (m.get("messages") or [])[-5:]:
                    if not c.execute("SELECT 1 FROM messages WHERE memberId=? AND text=?", (m["id"], t)).fetchone():
                        c.execute("INSERT INTO messages(memberId,text,createdAt) VALUES(?,?,?)", (m["id"], t, now_iso()))
            for p in d.get("promos", []):
                c.execute("INSERT INTO promos(id,businessId,text,createdAt) VALUES(?,?,?,?) ON CONFLICT(id) DO NOTHING",
                          (p.get("id"), bid, p.get("text"), now_iso()))
            for r in d.get("rewards", []):
                c.execute("INSERT INTO rewards(id,businessId,name,cost,active) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,cost=excluded.cost,active=excluded.active",
                          (r.get("id"), bid, r.get("name"), r.get("cost", 10), 1 if r.get("active", True) else 0))
            cfg = d.get("config") or {}
            for k in ("business", "issuerId", "classId"):
                if k in cfg:
                    c.execute("INSERT INTO config(businessId,k,v) VALUES(?,?,?) ON CONFLICT(businessId,k) DO UPDATE SET v=excluded.v", (bid, k, cfg[k]))
            c.commit(); c.close()
            return self._json({"ok": True})
        if u.path == "/api/scan":
            return self._json(do_scan(bid, d.get("memberId", ""), bool(d.get("force"))))
        if u.path == "/api/members":
            mid = d.get("id") or new_id()
            c = db()
            c.execute("""INSERT INTO members(id,businessId,name,phone,visits,stamps,points,streak,lastVisit,walletAdded,createdAt)
                         VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name""",
                      (mid, bid, d.get("name", "Member"), d.get("phone", ""), 0, 0, 0, 0, None, 0, now_iso()))
            c.execute("INSERT INTO messages(memberId,text,createdAt) VALUES(?,?,?)",
                      (mid, "Welcome to LoyalUp! Show your QR at the store.", now_iso()))
            c.commit()
            row = c.execute("SELECT * FROM members WHERE id=?", (mid,)).fetchone()
            m = member_with_messages(c, row)
            log(c, bid, "JOIN %s (%s)" % (m["name"], mid)); c.close()
            return self._json({"member": m})
        if u.path == "/api/promos":
            pid = new_id("P"); txt = d.get("text", "")
            c = db()
            c.execute("INSERT INTO promos VALUES(?,?,?,?)", (pid, bid, txt, now_iso()))
            for r in c.execute("SELECT id FROM members WHERE businessId=?", (bid,)).fetchall():
                c.execute("INSERT INTO messages(memberId,text,createdAt) VALUES(?,?,?)", (r["id"], "PROMO: " + txt, now_iso()))
            c.commit(); c.close(); log(bid, "PROMO: " + txt)
            return self._json({"ok": True, "id": pid})
        if u.path == "/api/rewards":
            rid = new_id("R")
            c = db()
            c.execute("INSERT INTO rewards VALUES(?,?,?,?,?)", (rid, bid, d.get("name", "Reward"), int(d.get("cost", 10) or 10), 1))
            c.commit(); c.close()
            return self._json({"ok": True, "id": rid})
        if u.path == "/api/admin/config":
            c = db()
            for k in ("business", "issuerId", "classId"):
                if k in d:
                    c.execute("INSERT INTO config(businessId,k,v) VALUES(?,?,?) ON CONFLICT(businessId,k) DO UPDATE SET v=excluded.v", (bid, k, d[k]))
            prof = d.get("profile") or {}
            for k in ("city", "size", "btype", "loc_label"):
                if k in prof:
                    c.execute("UPDATE businesses SET %s=? WHERE id=?" % k, (str(prof[k] or ""), bid))
            if "lat" in prof or "lng" in prof:
                try:
                    c.execute("UPDATE businesses SET lat=?,lng=? WHERE id=?",
                              (float(prof.get("lat") or 0), float(prof.get("lng") or 0), bid))
                except Exception:
                    pass
            if prof.get("business"):
                c.execute("UPDATE businesses SET name=? WHERE id=?", (prof["business"], bid))
            c.commit(); c.close()
            return self._json({"ok": True, "config": get_config(bid)})
        if u.path == "/api/auth/logout":
            h = self.headers.get("Authorization") or ""
            c = db(); c.execute("DELETE FROM sessions WHERE token=?", (h[7:] if h.startswith("Bearer ") else "",))
            c.commit(); c.close()
            return self._json({"ok": True})
        return self._json({"error": "unknown route"}, 404)

    def log_message(self, *a):
        pass

if __name__ == "__main__":
    init_db()
    print("LoyalUp platform on http://127.0.0.1:%d  (db: loyal.db)" % PORT, flush=True)
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
