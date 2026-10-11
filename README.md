# LoyalUp — Go-Live Checklist

Everything is built. The **only blocker is Google's approval**. Work through
this list top to bottom; each item says WHO does it and WHERE to paste things.

## 0. Run it locally right now (no keys needed)

```bash
cd C:\Users\aguia\OneDrive\Desktop\ossama
python server.py
```

Open http://127.0.0.1:8000/ — site, login, dashboard, QR + scan all work
against `loyal.db` (SQLite). Nothing else to install.

## 1. [YOU] Supabase — database for online (provide 2 links/keys)

1. Go to https://supabase.com → New project (free) → wait for provisioning.
2. Left menu → **SQL Editor** → paste the whole file `supabase/schema.sql` → Run.
3. **Project Settings → API** → copy:
   - Project URL (`https://xxxx.supabase.co`)
   - `anon` public key
4. Open `js/cloud-config.js` and paste them + set `enabled: true`:
   ```js
   window.LOYALUP_CLOUD = {
     enabled: true,
     supabaseUrl: "https://xxxx.supabase.co",
     supabaseKey: "eyJhbGciOi..."
   };
   ```
5. Reload the site → log in again → dashboards now read/write Supabase.
   (Local SQLite keeps working as offline fallback.)

**Send me:** the Project URL + anon key if you want me to paste & verify.

## 2. [YOU] Put the site online (free, 5 minutes)

Option A — Vercel (recommended, routing + wallet function included):
1. `vercel` in the folder (or Import Project on vercel.com) → you get
   `https://your-site.vercel.app`. `vercel.json` already fixes clean URLs
   (`/login`, `/dashboard`, `/pricing`…) so shared links open the right page.
2. Project → Settings → Environment Variables → add later (step 3):
   `SERVICE_ACCOUNT_JSON`, `ISSUER_ID`, `SUPABASE_URL`, `SUPABASE_KEY`.
   The wallet signer lives at `/api/wallet-jwt` (file `api/wallet-jwt.js`).

Option B — Netlify: drag the folder to https://app.netlify.com/drop
(same wallet signer at `/.netlify/functions/wallet-jwt`).

## 3. [YOU] Google Wallet — the only real blocker

1. Finish **Business profile** in the Pay & Wallet Console (required).
2. Sidebar **Google Wallet API** → copy your **Issuer ID** (NOT Merchant ID).
3. **Google Cloud Console** → IAM → Service Account → JSON key → download.
4. Dashboard (yours) → Wallet integration → paste Issuer ID → Save.
5. Online: Netlify env vars → `ISSUER_ID` + full `SERVICE_ACCOUNT_JSON`.
   Local test: `pip install google-auth` + save file as `service-account.json`
   next to `server.py` → `/api/wallet/jwt` flips from `demo` to `live`.
6. Ask me to auto-create the **Loyalty Class** via API, then we test one
   real "Add to Google Wallet" together.
7. Wait for **Google approval** — nothing else to build meanwhile.

**Send me:** Issuer ID + service-account.json (keep private — never commit it).

## 4. [YOU] Test flight (after 1–3 are done)

- [ ] Business registers at `/login.html` → dashboard opens with its own QR
- [ ] Phone scans business QR → `/join.html?b=...` → customer card created
- [ ] "Add to Google Wallet" → real pass appears (mode: live)
- [ ] Dashboard Scan station → +1 tampon, streak grows
- [ ] Promotions → appears in customer wallet messages
- [ ] Second business → sees only its own data

## 5. Project map (where everything lives)

- `index.html` — landing + live demo + per-business QR section
- `login.html` — business register/login (name + password)
- `dashboard.html` — guarded per-business dashboard (login required)
- `join.html?b=ID` — customer join page (encoded in each business QR)
- `css/style.css` — all styles, one file (~19KB, fast)
- `js/loyalty.js` — loyalty engine + auth + offline cache
- `js/cloud-config.js` — ★ YOUR Supabase keys go here (mock now)
- `js/cloud.js` — Supabase adapter (active only when keys are real)
- `js/app.js`, `js/dashboard.js` — page logic
- `server.py` + `loyal.db` — local backend + DB (zero installs)
- `supabase/schema.sql` — online DB schema (run once in Supabase)
- `netlify.toml` + `netlify/functions/wallet-jwt.js` — deploy + wallet signer

## 6. What to send me (nothing else needed)

1. Supabase Project URL + anon key
2. Google Issuer ID
3. service-account.json (private message, not email chain)
4. Business logo file (for wallet pass + site)

After that: I paste, verify end-to-end, and we wait on Google together.
