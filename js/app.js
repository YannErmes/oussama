/* Landing interactions: nav, billing toggle, smooth phones swap, wallet demo wiring */
function setBilling(t) { document.getElementById('bM').classList.toggle('on', t === 'm'); document.getElementById('bY').classList.toggle('on', t === 'y'); document.querySelectorAll('.p').forEach(function (e) { e.textContent = t === 'm' ? e.dataset.m : e.dataset.y; }); }
function toggleMenu() { var l = document.querySelector('.links'); if (!l) return; var open = l.dataset.open === '1'; if (!open) { l.style.display = 'flex'; l.style.flexDirection = 'column'; l.style.position = 'absolute'; l.style.top = '64px'; l.style.background = '#fff'; l.style.padding = '20px'; l.style.right = '10px'; l.style.border = '1px solid #eee'; l.style.borderRadius = '12px'; l.dataset.open = '1'; } else { l.removeAttribute('style'); l.dataset.open = '0'; } }

/* smooth phones swap — GPU only, glitch-free */
(function () {
  var phones = Array.prototype.slice.call(document.querySelectorAll('.lu-phone'));
  var zone = document.getElementById('swapZone');
  if (!phones.length || !zone) return;
  var order = [0, 1, 2], cls = ['pos-left', 'pos-center', 'pos-right'], animating = false, autoTimer = null;
  function render(incoming) { phones.forEach(function (ph) { var idx = parseInt(ph.dataset.i, 10); var pos = order.indexOf(idx); ph.classList.remove('pos-left', 'pos-center', 'pos-right', 'is-top'); void ph.offsetWidth; ph.classList.add(cls[pos]); if (idx === incoming) { ph.classList.add('is-top'); setTimeout(function () { ph.classList.remove('is-top'); }, 880); } }); }
  function bring(idx) { if (animating) return; var c = order.indexOf(idx); if (c === 1) return; animating = true; var t = order[c]; order[c] = order[1]; order[1] = t; render(idx); restart(); setTimeout(function () { animating = false; }, 880); }
  function step() { if (document.hidden) return; order.push(order.shift()); render(order[1]); }
  function restart() { if (autoTimer) clearInterval(autoTimer); autoTimer = setInterval(step, 3800); }
  phones.forEach(function (ph) { var i = parseInt(ph.dataset.i, 10); ph.addEventListener('mouseenter', function () { bring(i); }); ph.addEventListener('click', function () { bring(i); }); ph.addEventListener('touchstart', function () { bring(i); }, { passive: true }); });
  render(order[1]); restart();
})();

/* wallet demo wiring */
(function () {
  function $(id) { return document.getElementById(id); }
  // Real scannable QRs inside the 3 animated phones (retry until CDN lib ready)
  function paintPhoneQRs(tries) {
    if (!window.Loy) return;
    var els = document.querySelectorAll('.lu-phone .lu-qr[data-qr]');
    if (!els.length) return;
    if (!window.QRCode && (tries || 0) < 20) { setTimeout(function () { paintPhoneQRs((tries || 0) + 1); }, 250); }
    els.forEach(function (el) { try { Loy.drawQR(el, el.getAttribute('data-qr'), 120); } catch (e) {} });
  }
  paintPhoneQRs(0);
  window.addEventListener('load', function () { paintPhoneQRs(0); });
  var bQR = $('bizQR'), joinLink = $('joinLink');
  function paintBizQR() {
    if (!bQR || !window.Loy) return;
    var s = Loy.getSession && Loy.getSession();
    if (s) { Loy.drawQR(bQR, Loy.businessJoinURL()); if (joinLink) joinLink.textContent = Loy.businessJoinURL(); }
    else if (joinLink) joinLink.innerHTML = '<a href="login.html" style="color:var(--green);font-weight:800">Log in as a business to get YOUR QR code →</a>';
  }
  paintBizQR();
  // Hero "Scan & Get Rewarded" card: real scannable QR (business join link when logged in, demo link otherwise)
  (function paintHeroQR(tries) {
    var h = document.getElementById('heroQR');
    if (!h || !window.Loy) return;
    if (!window.QRCode && (tries || 0) < 20) { setTimeout(function () { paintHeroQR((tries || 0) + 1); }, 250); return; }
    var s = Loy.getSession && Loy.getSession();
    try { Loy.drawQR(h, s ? Loy.businessJoinURL() : h.getAttribute('data-qr'), 96); } catch (e) {}
  })(0);
  window.addEventListener('load', function () {
    var h = document.getElementById('heroQR');
    if (h && window.Loy && h.children.length === 0) {
      var s = Loy.getSession && Loy.getSession();
      try { Loy.drawQR(h, s ? Loy.businessJoinURL() : h.getAttribute('data-qr'), 96); } catch (e) {}
    }
  });
  // Pull this business's shared DB state on load (server authoritative when logged in)
  if (window.Loy && Loy.pullFromServer && Loy.getSession()) Loy.pullFromServer().then(function () { paintBizQR(); }).catch(function () {});
  var create = $('createMember'), nameI = $('memberName'), mCard = $('memberCard');
  if (create) create.addEventListener('click', function () {
    var m = Loy.createMember((nameI && nameI.value.trim()) || 'Salma B.');
    mCard.classList.add('show');
    $('mName').textContent = m.name; $('mId').textContent = m.id;
    Loy.drawQR($('memberQR'), Loy.memberURL(m));
    $('gwalletBtn').onclick = function () { m.walletAdded = true; var l = Loy.getMembers(); var f = l.find(function (x) { return x.id === m.id; }); if (f) { f.walletAdded = true; Loy.saveMembers(l); } Loy.getWalletSaveURL(m.id).then(function (url) { window.open(url, '_blank'); }); renderPromos(m.id); };
    $('scanId').value = m.id; renderPromos(m.id); updateStreak(m);
  });
  function updateStreak(m) { $('streakLine').innerHTML = '<span class="chip">🔥 streak ' + m.streak + '</span><span class="chip">★ ' + m.points + ' pts</span><span class="chip">● ' + m.stamps + '/10 stamps</span>'; }
  function renderPromos(id) { var m = Loy.getMember(id) || Loy.getMembers().slice(-1)[0]; if (!m) return; var box = $('promoFeed'); box.innerHTML = ''; (Loy.getPromos().slice(-3).concat(m.messages.slice(-2).map(function (t) { return { text: t }; }))).forEach(function (p) { var d = document.createElement('div'); d.className = 'promo'; d.textContent = p.text; box.appendChild(d); }); }
  var scan = $('doScan');
  if (scan) scan.addEventListener('click', function () {
    var id = $('scanId').value.trim(); var r = Loy.storeScan(id);
    var box = $('scanResult'); box.classList.add('show');
    if (r.error) { box.innerHTML = '⚠️ ' + r.error; return; }
    var bns = r.bonuses.map(function (b) { return '• ' + b.name; }).join('<br>') || '• Base visit +10 pts';
    box.innerHTML = '✅ <b>+1 tampon — Visite validée</b><br>Member: <b>' + r.member.name + '</b> (' + r.member.id + ')<br>+' + r.points + ' pts<br>' + bns + (r.reward ? '<br>🎁 <b>' + r.reward + '</b>' : '') + '<br>Streak: 🔥 ' + r.member.streak;
    updateStreak(r.member); renderPromos(r.member.id);
  });
  var cam = $('camScan');
  if (cam) cam.addEventListener('click', async function () {
    if (!('BarcodeDetector' in window)) { alert('Camera barcode scan not supported here — type the member code instead.'); return; }
    try {
      var s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      var v = document.createElement('video'); v.srcObject = s; await v.play();
      var det = new BarcodeDetector({ formats: ['qr_code'] });
      var tick = async function () { try { var c = await det.detect(v); if (c.length) { var txt = c[0].rawValue; var id = txt.split('/').pop(); $('scanId').value = id; s.getTracks().forEach(function (t) { t.stop(); }); scan.click(); return; } } catch (e) {} requestAnimationFrame(tick); };
      tick(); alert('Point the camera at the customer QR… (close tab to stop)');
    } catch (e) { alert('Camera blocked — type the code instead.'); }
  });
})();
