/* LoyalUp Google Wallet signer (Netlify Function, zero dependencies).
 * Env vars (Netlify dashboard -> Site settings -> Environment):
 *   SERVICE_ACCOUNT_JSON = full service-account.json contents
 *   ISSUER_ID            = your Google Wallet Issuer ID
 *   SUPABASE_URL / SUPABASE_KEY (optional: verifies member belongs to business)
 * GET /.netlify/functions/wallet-jwt?b=BIZ&member=ID -> {saveUrl, mode}
 * Without env vars it returns DEMO mode (same link shape) so the site works now.
 */
const crypto = require("node:crypto");

const b64 = (buf) => Buffer.from(buf).toString("base64url");
const b64json = (o) => b64(JSON.stringify(o));

exports.handler = async (event) => {
  const q = event.queryStringParameters || {};
  const member = q.member || q.m || "";
  const biz = q.b || "";
  const json = (o, code = 200) => ({ statusCode: code, headers: { "Content-Type": "application/json" }, body: JSON.stringify(o) });
  if (!member) return json({ error: "member required" }, 400);

  const saRaw = process.env.SERVICE_ACCOUNT_JSON || "";
  const issuer = process.env.ISSUER_ID || "";
  if (!saRaw || !issuer) {
    const jwt = "DEMO." + b64json({ iss: "demo@loyalup", member }) + ".SIGN_WITH_BACKEND";
    return json({ saveUrl: "https://pay.google.com/gp/v/save/" + jwt, mode: "demo",
      hint: "Set SERVICE_ACCOUNT_JSON + ISSUER_ID env vars to go live." });
  }
  try {
    const sa = JSON.parse(saRaw);
    // optional membership check
    if (process.env.SUPABASE_URL && process.env.SUPABASE_KEY && biz) {
      const r = await fetch(`${process.env.SUPABASE_URL}/rest/v1/members?id=eq.${encodeURIComponent(member)}&business_id=eq.${encodeURIComponent(biz)}&select=id`, {
        headers: { apikey: process.env.SUPABASE_KEY, Authorization: "Bearer " + process.env.SUPABASE_KEY } });
      const rows = await r.json();
      if (!rows || !rows.length) return json({ error: "Unknown card." }, 404);
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
    return json({ saveUrl: "https://pay.google.com/gp/v/save/" + head + "." + body + "." + sig, mode: "live" });
  } catch (e) {
    return json({ error: "signing failed: " + e.message }, 500);
  }
};
