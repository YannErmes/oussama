/* LoyalUp Google Wallet signer — Vercel Serverless Function (zero dependencies).
 * Env vars (Vercel dashboard -> Project -> Settings -> Environment Variables):
 *   SERVICE_ACCOUNT_JSON, ISSUER_ID, WALLET_SITE_URL (opt), WALLET_ORIGINS (opt)
 *   SUPABASE_URL (opt), SUPABASE_KEY (opt)
 * GET /api/wallet-jwt?b=BIZ&member=ID -> {saveUrl, mode}
 * Without env vars it returns DEMO mode (same link shape) so the site works now.
 *
 * The JWT ships the class AND the object so a pass can be saved even before the
 * class exists in the API. `origins` is required or the Wallet button is
 * refused by the browser's X-Frame-Options check.
 */
const crypto = require("node:crypto");

const b64 = (buf) => Buffer.from(buf).toString("base64url");
const b64json = (o) => b64(JSON.stringify(o));

const SITE = process.env.WALLET_SITE_URL || "https://loyalup-chi.vercel.app";
const CLASS_SUFFIX = "loyalup-loyalty-class";

function origins() {
  const raw = process.env.WALLET_ORIGINS || SITE;
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

function classPayload(issuer, bizName) {
  const name = (bizName || "LoyalUp").slice(0, 20);
  return {
    id: `${issuer}.${CLASS_SUFFIX}`,
    issuerName: name,
    reviewStatus: "UNDER_REVIEW",
    hexBackgroundColor: "#0A1F33",
    programName: name,
    programLogo: {
      sourceUri: { uri: SITE.replace(/\/$/, "") + "/logo.png" },
      contentDescription: { defaultValue: { language: "en-US", value: "LoyalUp" } },
    },
    heroImage: {
      sourceUri: { uri: SITE.replace(/\/$/, "") + "/hero.png" },
      contentDescription: { defaultValue: { language: "en-US", value: "LoyalUp" } },
    },
    homepageUri: { uri: SITE, description: "Open LoyalUp" },
    textModulesData: [
      { header: "How it works", body: { text: "Scan the store QR to join, then show your card at every visit to collect stamps." }, id: "HOW" },
      { header: "Rewards", body: { text: "10 stamps = 1 free reward. Bonus points on special occasions." }, id: "REWARDS" },
    ],
  };
}

function objectPayload(issuer, member, biz, memberRow) {
  const obj = {
    id: `${issuer}.${member.replace(/-/g, "").toLowerCase().slice(0, 20)}`,
    classId: `${issuer}.${CLASS_SUFFIX}`,
    state: "ACTIVE",
    accountId: member,
    accountName: ((memberRow && memberRow.name) || member).slice(0, 20),
    barcode: { type: "QR_CODE", value: member },
    linksModuleData: {
      uris: [{ uri: SITE.replace(/\/$/, "") + "/join.html?b=" + encodeURIComponent(biz) + "&m=" + encodeURIComponent(member),
               description: "Open my loyalty card", id: "CARD" }],
    },
  };
  if (memberRow && memberRow.points !== undefined && memberRow.points !== null) {
    obj.loyaltyPoints = { label: "Points", balance: { int: Number(memberRow.points) } };
  }
  if (memberRow && memberRow.stamps !== undefined && memberRow.stamps !== null) {
    obj.secondaryLoyaltyPoints = { label: "Stamps", balance: { int: Number(memberRow.stamps) } };
  }
  return obj;
}

module.exports = async (req, res) => {
  const member = (req.query && (req.query.member || req.query.m)) || "";
  const biz = (req.query && req.query.b) || "";
  if (!member) return res.status(400).json({ error: "member required" });

  const saRaw = process.env.SERVICE_ACCOUNT_JSON || "";
  const issuer = process.env.ISSUER_ID || "";
  if (!saRaw || !issuer) {
    const jwt = "DEMO." + b64json({ iss: "demo@loyalup", member }) + ".SIGN_WITH_BACKEND";
    return res.status(200).json({ saveUrl: "https://pay.google.com/gp/v/save/" + jwt, mode: "demo",
      hint: "Set SERVICE_ACCOUNT_JSON + ISSUER_ID env vars to go live." });
  }
  try {
    const sa = JSON.parse(saRaw);
    let memberRow = null;
    let bizName = "";
    if (process.env.SUPABASE_URL && process.env.SUPABASE_KEY && biz) {
      const r = await fetch(`${process.env.SUPABASE_URL}/rest/v1/members?id=eq.${encodeURIComponent(member)}&business_id=eq.${encodeURIComponent(biz)}&select=id,name,points,stamps`, {
        headers: { apikey: process.env.SUPABASE_KEY, Authorization: "Bearer " + process.env.SUPABASE_KEY } });
      const rows = await r.json();
      if (!rows || !rows.length) return res.status(404).json({ error: "Unknown card." });
      memberRow = rows[0];
      const br = await fetch(`${process.env.SUPABASE_URL}/rest/v1/businesses?id=eq.${encodeURIComponent(biz)}&select=name`, {
        headers: { apikey: process.env.SUPABASE_KEY, Authorization: "Bearer " + process.env.SUPABASE_KEY } });
      const brows = await br.json();
      if (brows && brows.length) bizName = brows[0].name || "";
    }
    const payload = { iss: sa.client_email, aud: "google", typ: "savetowallet", iat: Math.floor(Date.now() / 1000),
      origins: origins(),
      payload: { loyaltyClasses: [classPayload(issuer, bizName)],
                  loyaltyObjects: [objectPayload(issuer, member, biz, memberRow)] } };
    const head = b64json({ alg: "RS256", typ: "JWT" });
    const body = b64json(payload);
    const sign = crypto.createSign("RSA-SHA256");
    sign.update(head + "." + body);
    const sig = b64(sign.sign(sa.private_key));
    return res.status(200).json({ saveUrl: "https://pay.google.com/gp/v/save/" + head + "." + body + "." + sig, mode: "live" });
  } catch (e) {
    return res.status(500).json({ error: "signing failed: " + e.message });
  }
};
