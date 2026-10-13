/* ============================================================
   Cloud adapter — talks to Supabase REST when js/cloud-config.js
   holds REAL keys (enabled=true). Otherwise dormant (mock mode)
   and the app uses the Python/SQLite backend or offline cache.
   Same data shapes as server.py, so dashboards work identically.
   ============================================================ */
(function (w) {
  var C = w.LOYALUP_CLOUD || {};
  function enabled() {
    return C.enabled === true && (C.supabaseUrl || '').indexOf('http') === 0 &&
      (C.supabaseUrl || '').indexOf('YOUR-PROJECT') < 0 && (C.supabaseKey || '').indexOf('PASTE') < 0;
  }
  function H(json) {
    var h = { apikey: C.supabaseKey, Authorization: 'Bearer ' + C.supabaseKey };
    if (json) h['Content-Type'] = 'application/json';
    return h;
  }
  function q(path, opts) {
    opts = opts || {}; opts.headers = Object.assign({}, opts.headers || {}, H(true));
    return fetch(C.supabaseUrl + '/rest/v1/' + path, opts).then(function (r) {
      if (r.status === 204) return null;
      return r.json().then(function (d) { if (!r.ok) throw new Error((d && (d.message || d.error)) || r.status); return d; });
    });
  }
  function sha256(s) {
    if (w.crypto && crypto.subtle) {
      return crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)).then(function (b) {
        return Array.from(new Uint8Array(b)).map(function (x) { return ('0' + x.toString(16)).slice(-2); }).join('');
      });
    }
    var h1 = 0, h2 = 0; // tiny fallback (prototype only)
    for (var i = 0; i < s.length; i++) { h1 = (h1 * 31 + s.charCodeAt(i)) >>> 0; h2 = (h2 * 37 + s.charCodeAt(i)) >>> 0; }
    return Promise.resolve('f' + h1.toString(16) + h2.toString(16));
  }
  function biz(n) { return 'BIZ-' + Math.random().toString(36).slice(2, 8).toUpperCase(); }
  function sess(b) { try { localStorage.setItem('lyl_session', JSON.stringify({ token: 'cloud', businessId: b.id, businessName: b.name })); } catch (e) {} }

  function findBiz(name) {
    return q('businesses?name=ilike.' + encodeURIComponent(name) + '&select=*').then(function (rows) { return (rows && rows[0]) || null; });
  }
  function login(businessName, password, profile) {
    var name = (businessName || '').trim();
    profile = profile || {};
    return findBiz(name).then(function (b) {
      if (!b) { // auto-provision like the Python backend: new name just works
        var id = biz();
        return sha256(id + '::' + password).then(function (h) {
          var row = { id: id, name: name, pw: h, city: profile.city || '', size: profile.size || '',
            btype: profile.btype || '', lat: profile.lat || 0, lng: profile.lng || 0, loc_label: profile.loc_label || '' };
          function created(rows) {
            var nb = (rows && rows[0]) || { id: id, name: name };
            return seed(id).then(function () { sess(nb); return pull().then(function () { return { business: nb }; }); });
          }
          return q('businesses', { method: 'POST', headers: Object.assign(H(true), { Prefer: 'return=representation' }),
            body: JSON.stringify(row) }).then(created, function (err) {
            // Schema not upgraded yet (run supabase/schema.sql)? retry with base columns.
            if (String((err && err.message) || err).indexOf('schema cache') >= 0) {
              return q('businesses', { method: 'POST', headers: Object.assign(H(true), { Prefer: 'return=representation' }),
                body: JSON.stringify({ id: id, name: name, pw: h }) }).then(created);
            }
            throw err;
          });
        });
      }
      return sha256(b.id + '::' + password).then(function (h) {
        if (b.pw && b.pw !== h) throw new Error('Wrong password for this business.');
        sess(b); return pull().then(function () { return { business: b }; });
      });
    });
  }
  function seed(bid) {
    var cfg = [{ business_id: bid, k: 'business', v: '' }, { business_id: bid, k: 'issuerId', v: '' }, { business_id: bid, k: 'classId', v: 'loyalup-loyalty-class' }];
    var rw = [{ id: 'r1', business_id: bid, name: 'Free coffee', cost: 10, active: 1 }, { id: 'r2', business_id: bid, name: '-20% soin', cost: 8, active: 1 }];
    return q('config', { method: 'POST', body: JSON.stringify(cfg) }).catch(function () {})
      .then(function () { return q('rewards', { method: 'POST', body: JSON.stringify(rw) }).catch(function () {}); })
      .then(function () { return q('promos', { method: 'POST', body: JSON.stringify({ id: 'p1', business_id: bid, text: 'Welcome! -10% on your next visit' }) }).catch(function () {}); });
  }
  function pull() {
    var s; try { s = JSON.parse(localStorage.getItem('lyl_session') || 'null'); } catch (e) {}
    if (!s) return Promise.reject(new Error('login required'));
    var bid = s.businessId, pre = 'lyl_' + bid + '_';
    function set(k, v) { try { localStorage.setItem(pre + k, JSON.stringify(v)); } catch (e) {} }
    return q('members?business_id=eq.' + bid + '&select=*&order=created_at').then(function (members) {
      var ids = (members || []).map(function (m) { return m.id; });
      var msgQ = ids.length ? q('messages?member_id=in.(' + ids.join(',') + ')&select=*&order=id') : Promise.resolve([]);
      var proQ = q('promos?business_id=eq.' + bid + '&select=*&order=created_at');
      var rewQ = q('rewards?business_id=eq.' + bid + '&select=*');
      var cfgQ = q('config?business_id=eq.' + bid + '&select=*');
      return Promise.all([msgQ, proQ, rewQ, cfgQ]).then(function (rest) {
        var byM = {};
        (rest[0] || []).forEach(function (m) { (byM[m.member_id] = byM[m.member_id] || []).push(m.text); });
        set('members', (members || []).map(function (m) {
          return { id: m.id, name: m.name, phone: m.phone || '', visits: m.visits, stamps: m.stamps, points: m.points, streak: m.streak, lastVisit: m.last_visit, walletAdded: !!m.wallet_added, messages: byM[m.id] || [] };
        }));
        set('promos', (rest[1] || []).map(function (p) { return { id: p.id, text: p.text, date: p.created_at }; }));
        set('rewards', (rest[2] || []).map(function (r) { return { id: r.id, name: r.name, cost: r.cost, active: !!r.active }; }));
        var cfg = { business: s.businessName, issuerId: '', classId: 'loyalup-loyalty-class' };
        (rest[3] || []).forEach(function (c) { cfg[c.k] = c.v; });
        set('cfg', cfg); set('log', []);
        return true;
      });
    });
  }
  function save(state) {
    var s; try { s = JSON.parse(localStorage.getItem('lyl_session') || 'null'); } catch (e) {}
    if (!s) return Promise.resolve();
    var bid = s.businessId;
    var up = function (tbl, rows, conflict) {
      if (!rows || !rows.length) return Promise.resolve();
      return q(tbl + '?on_conflict=' + conflict, { method: 'POST',
        headers: Object.assign(H(true), { Prefer: 'resolution=merge-duplicates' }), body: JSON.stringify(rows) }).catch(function () {});
    };
    var mem = (state.members || []).map(function (m) {
      return { id: m.id, business_id: bid, name: m.name, phone: m.phone || '', visits: m.visits, stamps: m.stamps, points: m.points, streak: m.streak, last_visit: m.lastVisit, wallet_added: m.walletAdded ? 1 : 0 };
    });
    var chain = up('members', mem, 'id')
      .then(function () { return up('promos', (state.promos || []).map(function (p) { return { id: p.id, business_id: bid, text: p.text }; }), 'id'); })
      .then(function () { return up('rewards', (state.rewards || []).map(function (r) { return { id: r.id, business_id: bid, name: r.name, cost: r.cost, active: r.active ? 1 : 0 }; }), 'id'); })
      .then(function () {
        var cfg = state.config || {}, rows = Object.keys(cfg).map(function (k) { return { business_id: bid, k: k, v: String(cfg[k]) }; });
        return up('config', rows, 'business_id,k');
      });
    // append only new messages
    (state.members || []).forEach(function (m) {
      (m.messages || []).slice(-3).forEach(function (t) {
        chain = chain.then(function () {
          return q('messages?member_id=eq.' + encodeURIComponent(m.id) + '&text=eq.' + encodeURIComponent(t) + '&select=id&limit=1').then(function (ex) {
            if (!(ex && ex.length)) return q('messages', { method: 'POST', body: JSON.stringify({ member_id: m.id, text: t }) }).catch(function () {});
          }).catch(function () {});
        });
      });
    });
    return chain;
  }
  function updateProfile(prof) {
    var s; try { s = JSON.parse(localStorage.getItem('lyl_session') || 'null'); } catch (e) {}
    if (!s) return Promise.reject(new Error('login required'));
    var row = {};
    ['city', 'size', 'btype', 'loc_label'].forEach(function (k) { if (prof[k] !== undefined) row[k] = prof[k]; });
    return q('businesses?id=eq.' + encodeURIComponent(s.businessId), { method: 'PATCH', body: JSON.stringify(row) }).then(function () {
      try { s.profile = Object.assign(s.profile || {}, prof); localStorage.setItem('lyl_session', JSON.stringify(s)); } catch (e) {}
    });
  }
  function adminOverview() {
    return q('businesses?select=*&order=created_at.desc').then(function (biz) {
      var bids = (biz || []).map(function (b) { return b.id; });
      var memQ = bids.length ? q('members?business_id=in.(' + bids.join(',') + ')&select=id,business_id,visits,points,streak') : Promise.resolve([]);
      var proQ = bids.length ? q('promos?business_id=in.(' + bids.join(',') + ')&select=id,business_id') : Promise.resolve([]);
      var rewQ = bids.length ? q('rewards?business_id=in.(' + bids.join(',') + ')&select=id,business_id') : Promise.resolve([]);
      return Promise.all([memQ, proQ, rewQ]).then(function (r) {
        var agg = {};
        bids.forEach(function (id) { agg[id] = { customers: 0, visits: 0, points: 0, best_streak: 0, promos: 0, rewards: 0 }; });
        (r[0] || []).forEach(function (m) { var a = agg[m.business_id]; if (!a) return; a.customers++; a.visits += m.visits || 0; a.points += m.points || 0; if ((m.streak || 0) > a.best_streak) a.best_streak = m.streak; });
        (r[1] || []).forEach(function (p) { if (agg[p.business_id]) agg[p.business_id].promos++; });
        (r[2] || []).forEach(function (x) { if (agg[x.business_id]) agg[x.business_id].rewards++; });
        var list = (biz || []).map(function (b) {
          return Object.assign({ id: b.id, name: b.name, city: b.city || '', btype: b.btype || '', size: b.size || '', createdAt: b.created_at }, agg[b.id]);
        });
        var tot = { businesses: list.length, customers: 0, visits: 0, points: 0 };
        list.forEach(function (x) { tot.customers += x.customers; tot.visits += x.visits; tot.points += x.points; });
        return { businesses: list, totals: tot };
      });
    });
  }
  function adminBusiness(bid) {
    return q('businesses?id=eq.' + encodeURIComponent(bid) + '&select=*').then(function (rows) {
      if (!(rows && rows[0])) throw new Error('Unknown business.');
      var b = rows[0];
      return q('members?business_id=eq.' + encodeURIComponent(bid) + '&select=id,name,phone,visits,stamps,points,streak,last_visit&order=created_at.desc').then(function (ms) {
        return { business: { id: b.id, name: b.name, city: b.city || '', btype: b.btype || '', size: b.size || '' },
          members: (ms || []).map(function (m) { return { id: m.id, name: m.name, visits: m.visits, stamps: m.stamps, points: m.points, streak: m.streak, lastVisit: m.last_visit }; }) };
      });
    });
  }
  function bizInfo(bid) {
    return q('businesses?id=eq.' + encodeURIComponent(bid) + '&select=id,name').then(function (rows) {
      if (!(rows && rows[0])) throw new Error('Unknown business QR.');
      return q('config?business_id=eq.' + encodeURIComponent(bid) + '&select=k,v').then(function (cfg) {
        var name = rows[0].name;
        (cfg || []).forEach(function (c) { if (c.k === 'business' && c.v) name = c.v; });
        return { businessId: bid, businessName: name };
      });
    });
  }
  function join(bid, name, memberId) {
    var mid = memberId || ('LYL-' + Math.random().toString(36).slice(2, 6).toUpperCase() + Date.now().toString(36).slice(-4).toUpperCase());
    return q('members', { method: 'POST', headers: Object.assign(H(true), { Prefer: 'return=representation' }),
      body: JSON.stringify({ id: mid, business_id: bid, name: name || 'Guest' }) }).then(function () {
      return q('messages', { method: 'POST', body: JSON.stringify({ member_id: mid, text: 'Welcome to LoyalUp! Show your QR at the store.' }) }).catch(function () {});
    }).then(function () { return { memberId: mid }; });
  }
  w.Cloud = { enabled: enabled, login: login, signup: login, pull: pull, save: save, updateProfile: updateProfile, adminOverview: adminOverview, adminBusiness: adminBusiness, bizInfo: bizInfo, join: join };
})(window);
