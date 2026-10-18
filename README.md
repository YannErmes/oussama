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

## 3. [DONE] Google Wallet — live

✅ **Issuer ID:** `3388000000023219155`
✅ **Class ID:** `loyalup-loyalty-class` (full: `3388000000023219155.loyalup-loyalty-class`)
✅ **Service account:** `loyalupapp@sonorous-folio-511917-v5.iam.gserviceaccount.com`

The "Add to Google Wallet" button already returns **live signed links**
(`/api/wallet/jwt` → mode: `live`). Remaining:

- [ ] **Publish**: console → Google Wallet API → Manage → switch class to
      `UNDER_REVIEW` + complete Business profile (needed for the button to work
      on real customers' phones; testing works in demo mode meanwhile)
- [ ] **Online env vars** (Vercel → Environment Variables):
      - `SERVICE_ACCOUNT_JSON` = full contents of service-account.json
      - `ISSUER_ID` = `3388000000023219155`
      - `SUPABASE_URL`, `SUPABASE_KEY` (optional membership check)
- [ ] **Auto-updating stamps** (nice-to-have, later): needs the
      `walletobjects.issuer` OAuth scope, which Google refused during setup.
      Stamps can be refreshed by re-adding the pass until then.
- [ ] **Rotate the key** — `oussama-app-511914` and the first JSON were pasted
      in chat; delete both keys in Google Cloud and use only the new one.

**Send me:** Issuer ID + service-account.json (keep private — never commit it).

## 4. [YOU] Test flight (after 1–3 are done)

- [ ] Business registers at `/signup.html` → dashboard opens with its own QR
- [ ] Phone scans business QR → `/join.html?b=...` → customer card created
- [ ] "Add to Google Wallet" → real pass appears (mode: live)
- [ ] Dashboard Scan station → +1 tampon, streak grows
- [ ] Promotions → appears in customer wallet messages
- [ ] Second business → sees only its own data

## 5. Project map (where everything lives)

- `index.html` — landing + live demo + per-business QR section
- `login.html` — business login (name + password only, stays logged in)
- `signup.html` — business registration (city, size, type, map location)
- `admin.html` — founder command center (all businesses, founder password)
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

## 6. Founder access (SaaS owner)

- The founder entry is hidden in plain sight on the normal login page —
  you know the trick, nobody else sees a hint anywhere.
- Open `/admin.html` directly any time to use the command center
  (requires the hidden session; otherwise it quietly returns to login).

## 7. What to send me (nothing else needed)

1. Supabase Project URL + anon key
2. Google Issuer ID
3. service-account.json (private message, not email chain)
4. Business logo file (for wallet pass + site)

After that: I paste, verify end-to-end, and we wait on Google together.
