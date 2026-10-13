/* Dashboard page logic — tabs, customers, rewards, scan station, promos, wallet integration */
(function () {
  function $(id) { return document.getElementById(id); }
  if (!window.Loy) return;
  // tabs
  document.querySelectorAll('.db-link').forEach(function (l) {
    l.addEventListener('click', function () {
      document.querySelectorAll('.db-link').forEach(function (x) { x.classList.remove('on'); });
      document.querySelectorAll('.db-tabs').forEach(function (x) { x.classList.remove('on'); });
      l.classList.add('on'); $(l.dataset.tab).classList.add('on');
    });
  });
  function refresh() {
    var ms = Loy.getMembers();
    var visits = ms.reduce(function (a, m) { return a + m.visits; }, 0);
    $('stMembers').textContent = ms.length;
    $('stVisits').textContent = visits;
    $('stRewards').textContent = ms.filter(function (m) { return m.messages.join('').includes('Récompense'); }).length;
    $('stStreak').textContent = ms.length ? Math.max.apply(null, ms.map(function (m) { return m.streak; })) + ' 🔥' : '0';
    // customers table
    $('custTable').innerHTML = ms.map(function (m) {
      return '<tr><td><b>' + m.name + '</b><br><small>' + m.id + '</small></td><td>' + m.visits + '</td><td>' + m.stamps + '/10</td><td>' + m.points + '</td><td>' + m.streak + ' 🔥</td><td>' + (m.walletAdded ? '<span class="tag">Wallet ✓</span>' : '<span class="tag warn">No wallet</span>') + '</td></tr>';
    }).join('') || '<tr><td colspan="6">No customers yet — create one on the landing page or below.</td></tr>';
    // scan select
    $('scanMember').innerHTML = ms.map(function (m) { return '<option value="' + m.id + '">' + m.name + ' — ' + m.id + '</option>'; }).join('');
    // rewards
    var rw = Loy.getRewards();
    $('rewardList').innerHTML = rw.map(function (r) { return '<tr><td>' + r.name + '</td><td>' + r.cost + ' stamps</td><td>' + (r.active ? '<span class="tag">Active</span>' : '<span class="tag warn">Off</span>') + '</td></tr>'; }).join('');
    // promos
    $('promoList').innerHTML = Loy.getPromos().slice().reverse().map(function (p) { return '<div class="promo">' + p.text + '</div>'; }).join('');
    $('bizQRdash').innerHTML = ''; Loy.drawQR($('bizQRdash'), Loy.businessJoinURL());
    $('joinURLdash').textContent = Loy.businessJoinURL();
    $('logBox').textContent = Loy.getLog().join('\n') || 'No activity yet.';
    var c = Loy.getCfg(); $('cfgBusiness').value = c.business; $('cfgIssuer').value = c.issuerId || ''; $('cfgClass').value = c.classId || '';
    // business profile (from login: city, size, type, map pin)
    var s = Loy.getSession && Loy.getSession(), prof = (s && s.profile) || {};
    if ($('profLine')) {
      var bits = [prof.btype, prof.city, prof.size ? prof.size + ' people' : '', prof.loc_label].filter(function (x) { return x; });
      $('profLine').innerHTML = bits.length ? bits.map(function (b) { return '<span class="chip" style="background:#EDFBF3;color:#0a7a4f">' + b + '</span>'; }).join(' ') : '<span class="muted" style="font-size:12px">No profile yet — set it at next login.</span>';
    }
    if ($('profCity') && document.activeElement !== $('profCity')) {
      if (prof.city) $('profCity').value = prof.city;
      if (prof.size) $('profSize').value = prof.size;
      if (prof.btype) $('profType').value = prof.btype;
    }
  }
  $('addCust').addEventListener('click', function () { var n = $('newCustName').value.trim() || 'Salma B.'; Loy.createMember(n); $('newCustName').value = ''; refresh(); });
  $('addReward').addEventListener('click', function () {
    var name = $('rwName').value.trim() || 'Free item'; var cost = parseInt($('rwCost').value, 10) || 10;
    var r = Loy.getRewards(); r.push({ id: 'r' + Date.now(), name: name, cost: cost, active: true });
    Loy.saveRewards(r);
    $('rwName').value = ''; refresh();
  });
  $('dashScan').addEventListener('click', function () {
    var id = $('scanMember').value || $('scanCode').value.trim();
    var r = Loy.storeScan(id, { force: $('forceScan').checked });
    var box = $('dashScanResult'); box.classList.add('show');
    box.innerHTML = r.error ? '⚠️ ' + r.error : '✅ <b>' + r.member.name + '</b> +1 tampon, +' + r.points + ' pts, streak 🔥 ' + r.member.streak + (r.reward ? '<br>🎁 ' + r.reward : '') + '<br><small>' + r.bonuses.map(function (b) { return b.name; }).join(' • ') + '</small>';
    refresh();
  });
  $('sendPromo').addEventListener('click', function () { var t = $('promoText').value.trim(); if (!t) return; Loy.pushPromo(t); $('promoText').value = ''; refresh(); });
  $('saveCfg').addEventListener('click', function () {
    Loy.saveCfg({ business: $('cfgBusiness').value.trim() || 'LoyalUp Demo Store', issuerId: $('cfgIssuer').value.trim(), classId: $('cfgClass').value.trim() || 'loyalup-loyalty-class' });
    refresh(); alert('Saved. Business QR now points to your store.');
  });
  var saveProf = $('saveProfile');
  if (saveProf) saveProf.addEventListener('click', function () {
    var prof = { city: $('profCity').value, size: $('profSize').value, btype: $('profType').value };
    function done() {
      var s = Loy.getSession(); if (s) { try { s.profile = Object.assign(s.profile || {}, prof); localStorage.setItem('lyl_session', JSON.stringify(s)); } catch (e) {} }
      refresh(); alert('Profile saved.');
    }
    if (window.Cloud && Cloud.enabled && Cloud.enabled()) { Cloud.updateProfile(prof).then(done).catch(function () { done(); }); return; }
    fetch('/api/admin/config', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (Loy.getSession().token || '') }, body: JSON.stringify({ profile: prof }) })
      .then(function () { return Loy.pullFromServer ? Loy.pullFromServer().catch(function () {}) : null; }).then(done).catch(function () { done(); });
  });
  $('testWallet').addEventListener('click', function () {
    var ms = Loy.getMembers(); if (!ms.length) { alert('Create a customer first.'); return; }
    Loy.getWalletSaveURL(ms[ms.length - 1].id).then(function (url) { window.open(url, '_blank'); });
  });
  if (Loy.pullFromServer) Loy.pullFromServer().then(function () { refresh(); }).catch(function () {});
  refresh();
})();
