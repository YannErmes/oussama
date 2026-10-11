/* LoyalUp Google Wallet signer — Vercel Serverless Function (zero dependencies).
 * Env vars (Vercel dashboard -> Project -> Settings -> Environment Variables):
 *   SERVICE_ACCOUNT_JSON, ISSUER_ID, SUPABASE_URL (opt), SUPABASE_KEY (opt)
 * GET /api/wallet-jwt?b=BIZ&member=ID -> {saveUrl, mode}
 * Without env vars it returns DEMO mode (same link shape) so the site works now.
 */
const crypto = require("node:crypto");

const b64 = (buf) => Buffer.from(buf).toString("base64url");
const b64json = (o) => b64(JSON.stringify(o));

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
    if (process.env.SUPABASE_URL && process.env.SUPABASE_KEY && biz) {
      const r = await fetch(`${process.env.SUPABASE_URL}/rest/v1/members?id=eq.${encodeURIComponent(member)}&business_id=eq.${encodeURIComponent(biz)}&select=id`, {
        headers: { apikey: process.env.SUPABASE_KEY, Authorization: "Bearer " + process.env.SUPABASE_KEY } });
      const rows = await r.json();
      if (!rows || !rows.length) return res.status(404).json({ error: "Unknown card." });
    }
    const classId = `${issuer}.loyalup-loyalty-class`;
    const payload = { iss: sa.client_email, aud: "google", typ: "savetowallet", iat: Math.floor(Date.now() / 1000),
      payload: { loyaltyObjects: [{ id: `${issuer}.${member.replace(/-/g, "").toLowerCase().slice(0, 20)}`,
        classId, state: "active", accountId: member, accountName: member,
        barcode: { type: "qrCode", value: member } }] } };
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
