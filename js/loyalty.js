/* ============================================================
   LoyalUp engine — multi-business platform.
   Business logs in (name + password) -> token session.
   All data is namespaced per business; server (SQLite) is
   source of truth when online, localStorage is offline cache.
   ============================================================ */
(function (w) {
  // ---- session ----
  function getSession() { try { return JSON.parse(localStorage.getItem('lyl_session') || 'null'); } catch (e) { return null; } }
  function setSession(s) { try { if (s) localStorage.setItem('lyl_session', JSON.stringify(s)); else localStorage.removeItem('lyl_session'); } catch (e) {} }
  function bizId() { var s = getSession(); return (s && s.businessId) || 'pub'; }
  function K(k) { return 'lyl_' + bizId() + '_' + k; }
  var LEGACY = { members: 'lyl_members', promos: 'lyl_promos', rewards: 'lyl_rewards', log: 'lyl_log', cfg: 'lyl_cfg' };
  function read(k, fb) {
    try {
      var v = localStorage.getItem(K(k));
      if (v) return JSON.parse(v);
      var lv = localStorage.getItem(LEGACY[k]); // migrate old single-business cache once
      if (lv) { localStorage.setItem(K(k), lv); return JSON.parse(lv); }
      return fb;
    } catch (e) { return fb; }
  }
  function write(k, v) { try { localStorage.setItem(K(k), JSON.stringify(v)); } catch (e) {} }
  function uid(p) { return (p || 'LYL') + '-' + Math.random().toString(36).slice(2, 6).toUpperCase() + Date.now().toString(36).slice(-4).toUpperCase(); }

  function useCloud() { return (w.Cloud && Cloud.enabled && Cloud.enabled()); }
  function login(businessName, password) {
    if (useCloud()) return Cloud.login(businessName, password);
    return api('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ businessName: businessName, password: password }) }).then(function (d) {
      if (d.error) throw new Error(d.error);
      setSession({ token: d.token, businessId: d.business.id, businessName: d.business.name });
      return pullFromServer().then(function () { return d; });
    });
  }
  function signup(businessName, password) {
    if (useCloud()) return Cloud.login(businessName, password);
    return api('/api/auth/signup', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ businessName: businessName, password: password }) }).then(function (d) {
      if (d.error) throw new Error(d.error);
      setSession({ token: d.token, businessId: d.business.id, businessName: d.business.name });
      return pullFromServer().then(function () { return d; });
    });
  }
  function logout() {
    var s = getSession();
    setSession(null);
    if (s) fetch('/api/auth/logout', { method: 'POST', headers: authH() }).catch(function () {});
  }
  function requireSession() {
    var s = getSession();
    if (!s) { location.href = 'login.html'; return null; }
    return s;
  }

  // Bonus occasions (special days give extra points)
  function occasionBonus(date) {
    date = date || new Date();
    var m = date.getMonth(), d = date.getDate(), day = date.getDay();
    var out = [];
    if ((m === 11 && d >= 20) || (m === 0 && d <= 7)) out.push({ name: 'Christmas / New Year x2 stamps', points: 20, stamps: 1 });
    if (day === 0 || day === 6) out.push({ name: 'Weekend +10 pts', points: 10, stamps: 0 });
    return out;
  }

  function getMembers() { return read('members', []); }
  function saveMembers(list) { write('members', list); }
  function getRewards() {
    var r = read('rewards', null);
    if (!r) { r = [{ id: 'r1', name: 'Free coffee', cost: 10, active: true }, { id: 'r2', name: '-20% soin', cost: 8, active: true }]; write('rewards', r); }
    return r;
  }
  function getPromos() { return read('promos', [{ id: 'p1', text: 'Welcome! -10% on your next visit', date: Date.now() }]); }

  function createMember(name) {
    var list = getMembers();
    var m = { id: uid('LYL'), name: name || 'oussama bouqontar', visits: 0, stamps: 0, points: 0, streak: 0, lastVisit: null, walletAdded: false, messages: ['Welcome to LoyalUp! Show your QR at the store.'] };
    list.push(m); saveMembers(list); pushLog('JOIN ' + m.name + ' (' + m.id + ')');
    pushState();
    return m;
  }
  function getMember(id) { return getMembers().find(function (m) { return m.id === id; }) || null; }

  // Store scans the customer's fidelity QR
  function storeScan(memberId, opts) {
    opts = opts || {};
    var list = getMembers();
    var m = list.find(function (x) { return x.id === memberId; });
    if (!m) return { error: 'Unknown code for this business. Customer must join with YOUR QR.' };
    var now = new Date();
    var sameDay = m.lastVisit && new Date(m.lastVisit).toDateString() === now.toDateString();
    if (sameDay && !opts.force) return { error: 'Already scanned today — streak protected (1 stamp / day).', member: m };
    var bonuses = occasionBonus(now);
    var pts = 10, stamps = 1;
    bonuses.forEach(function (b) { pts += b.points; stamps += b.stamps; });
    if (m.streak >= 4) { pts += 20; bonuses.push({ name: 'Streak bonus +20 pts', points: 20, stamps: 0 }); }
    m.visits++; m.stamps += stamps; m.points += pts; m.streak++;
    m.lastVisit = now.toISOString();
    var reward = null;
    if (m.stamps >= 10) { m.stamps -= 10; reward = 'Reward unlocked (free item)'; m.messages.push('Récompense débloquée — show this to redeem!'); }
    m.messages.push('+1 tampon — Visite validée (' + m.visits + ')');
    saveMembers(list); pushLog('SCAN ' + m.name + ' +' + pts + 'pts, streak ' + m.streak);
    pushState();
    return { member: m, points: pts, bonuses: bonuses, reward: reward };
  }

  function pushPromo(text) {
    var promos = getPromos(); promos.push({ id: uid('P'), text: text, date: Date.now() }); write('promos', promos);
    var list = getMembers(); list.forEach(function (m) { m.messages.push('PROMO: ' + text); }); saveMembers(list);
    pushLog('PROMO: ' + text); pushState(); return promos;
  }
  function pushLog(line) { var l = read('log', []); l.unshift(new Date().toLocaleString() + '  ' + line); write('log', l.slice(0, 200)); }
  function getLog() { return read('log', []); }
  function getCfg() { return read('cfg', { business: 'LoyalUp Demo Store', issuerId: '', classId: 'loyalup-loyalty-class' }); }
  function saveCfg(c) { write('cfg', c); pushState(); }
  function saveRewards(r) { write('rewards', r); pushState(); }

  // ---- QR helpers (real QR via CDN lib, realistic fallback) ----
  function drawQR(el, text, size) {
    size = size || 150;
    el.innerHTML = '';
    if (w.QRCode) { try { new w.QRCode(el, { text: text, width: size, height: size, correctLevel: QRCode.CorrectLevel.M }); return; } catch (e) {} }
    var c = document.createElement('canvas'); c.width = size; c.height = size;
    var x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, size, size); x.fillStyle = '#111';
    var n = 25, cell = size / n, h = 0;
    for (var i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) >>> 0;
    function finder(col, row) {
      x.fillStyle = '#111'; x.fillRect(col * cell, row * cell, 7 * cell, 7 * cell);
      x.fillStyle = '#fff'; x.fillRect((col + 1) * cell, (row + 1) * cell, 5 * cell, 5 * cell);
      x.fillStyle = '#111'; x.fillRect((col + 2) * cell, (row + 2) * cell, 3 * cell, 3 * cell);
    }
    var r, q, inF;
    for (r = 0; r < n; r++) for (q = 0; q < n; q++) {
      inF = (r < 8 && q < 8) || (r < 8 && q >= n - 8) || (r >= n - 8 && q < 8);
      if (inF) continue;
      if (r === 6 || q === 6) { if ((r + q) % 2 === 0) x.fillRect(q * cell, r * cell, cell, cell); continue; }
      if ((((r * 31 + q * 17 + h) >> ((r + q) % 5)) & 1) === 1) x.fillRect(q * cell, r * cell, cell - .3, cell - .3);
    }
    finder(0, 0); finder(n - 7, 0); finder(0, n - 7);
    el.appendChild(c);
  }
  function origin() { try { return location.origin; } catch (e) { return 'https://loyalup.ma'; } }
  function memberURL(m) { return origin() + '/join.html?b=' + bizId() + '&m=' + m.id; }
  function businessJoinURL() { return origin() + '/join.html?b=' + bizId(); }

  // ---- Google Wallet ----
  function googleWalletSaveURL(member) {
    var c = getCfg();
    var demoJwt = 'DEMO.' + btoa(JSON.stringify({ iss: c.issuerId || 'demo@loyalup', member: member.id })).replace(/=+$/, '') + '.SIGN_WITH_BACKEND';
    return 'https://pay.google.com/gp/v/save/' + demoJwt;
  }

  // ---- Backend sync ----
  var HAS_API = location.protocol.indexOf('http') === 0;
  function authH() { var s = getSession(); var h = { 'Content-Type': 'application/json' }; if (s && s.token) h.Authorization = 'Bearer ' + s.token; return h; }
  function api(path, opts) {
    if (!HAS_API) return Promise.reject(new Error('no-backend'));
    opts = opts || {}; opts.headers = Object.assign({}, opts.headers || {}, authH());
    return fetch(path, opts).then(function (r) { return r.json().then(function (d) { if (!r.ok) throw new Error((d && d.error) || r.status); return d; }); });
  }
  function pushState() {
    if (useCloud()) { try { Cloud.save({ members: getMembers(), promos: getPromos(), rewards: getRewards(), config: getCfg() }).catch(function () {}); } catch (e) {} return; }
    if (!HAS_API || !getSession()) return;
    try {
      api('/api/sync', { method: 'POST',
        body: JSON.stringify({ members: getMembers(), promos: getPromos(), rewards: getRewards(), config: getCfg() }) })
        .catch(function () {});
    } catch (e) {}
  }
  function pullFromServer() {
    if (useCloud()) return Cloud.pull();
    return api('/api/bootstrap').then(function (d) {
      if (d.business) setSession(Object.assign(getSession() || {}, { businessId: d.business.id, businessName: d.business.name }));
      if (d.members) write('members', d.members);
      if (d.promos) write('promos', d.promos);
      if (d.rewards) write('rewards', d.rewards);
      if (d.config) write('cfg', d.config);
      if (d.log) write('log', d.log);
      return d;
    });
  }
  function getWalletSaveURL(memberId) {
    // Online serverless signer first (works on Netlify without Python backend)
    var netlify = fetch('/.netlify/functions/wallet-jwt?b=' + encodeURIComponent(bizId()) + '&member=' + encodeURIComponent(memberId))
      .then(function (r) { return r.json(); }).then(function (d) { if (!d.saveUrl) throw new Error('no-url'); return d.saveUrl; });
    return netlify.catch(function () {
      return api('/api/wallet/jwt?member=' + encodeURIComponent(memberId))
        .then(function (d) { return d.saveUrl; })
        .catch(function () { var m = getMember(memberId); return googleWalletSaveURL(m || { id: memberId }); });
    });
  }

  w.Loy = { getSession: getSession, login: login, signup: signup, logout: logout, requireSession: requireSession,
    getMembers: getMembers, saveMembers: saveMembers, createMember: createMember, getMember: getMember,
    storeScan: storeScan, getRewards: getRewards, saveRewards: saveRewards, getPromos: getPromos,
    pushPromo: pushPromo, getLog: getLog, getCfg: getCfg, saveCfg: saveCfg, drawQR: drawQR,
    memberURL: memberURL, businessJoinURL: businessJoinURL, googleWalletSaveURL: googleWalletSaveURL,
    getWalletSaveURL: getWalletSaveURL, pullFromServer: pullFromServer, occasionBonus: occasionBonus };
})(window);
