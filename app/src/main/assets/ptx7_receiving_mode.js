/*
 * PTX7 PIMS Receiving Mode — injected overlay
 * -------------------------------------------------
 * A simplified, large-button receiving flow driven by the device's
 * built-in hardware (keyboard-wedge) scanner. Camera is not used here.
 *
 * Flow:
 *   1. SCAN NDC            -> read PIMS "Incoming Purchases" POs for that NDC
 *   2. TAP the correct PO  -> navigate PIMS into that PO's receive page
 *   3. SCAN MEDICATION     -> confirm it matches the chosen NDC
 *   4. SCAN LOCATION       -> confirm, show PUT AWAY, loop to step 1
 *
 * The operator can EXIT TO PIMS at any time to use the raw page.
 *
 * This script is intentionally self-contained and namespaced under
 * window.__ptx7Rx so it never collides with the existing mobile-UI
 * enhancement injection.
 */
(function () {
  'use strict';

  if (window.__ptx7RxInstalled) {
    // Already installed on this document. Just make sure it is showing if
    // Android asked us to (re)open it.
    if (window.__ptx7RxReopen) window.__ptx7Rx.open();
    return;
  }
  window.__ptx7RxInstalled = true;

  // ---------------------------------------------------------------------------
  // Small helpers (ported/condensed from the v2.26.1 Tampermonkey assistant)
  // ---------------------------------------------------------------------------
  var INVENTORY_URL = 'https://console.inventory.pharmacy.amazon.dev/inventory?facility=PTX7';

  function digitsOnly(v) { return String(v == null ? '' : v).replace(/\D/g, ''); }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // Expanding set of plausible NDC forms from a raw UPC/GTIN/NDC scan.
  function ndcCandidates(value) {
    var d = digitsOnly(value); var set = {};
    if (!d) return set;
    set[d] = true;
    [11, 10].forEach(function (len) {
      if (d.length >= len) for (var i = 0; i <= d.length - len; i++) set[d.slice(i, i + len)] = true;
    });
    if (d.length >= 12) { set[d.slice(1, -1)] = true; set[d.slice(2, -1)] = true; }
    return set;
  }

  // Returns a 0..100 confidence score comparing a stored NDC to a scan.
  function ndcMatchScore(stored, scanned) {
    var a = digitsOnly(stored), b = digitsOnly(scanned);
    if (!a || !b) return 0;
    if (a === b) return 100;
    if (b.indexOf(a) >= 0 || a.indexOf(b) >= 0) return 99;
    var A = ndcCandidates(a), B = ndcCandidates(b);
    for (var x in A) for (var y in B) {
      if (x && y && x === y) return 98;
      if (x.length >= 9 && y.length >= 9 && (x.indexOf(y) >= 0 || y.indexOf(x) >= 0)) return 96;
    }
    // Same stable 10-digit product prefix with package/check-digit variance.
    var variants = {}; variants[b] = true;
    if (b.length === 12) variants[b.slice(1)] = true;
    if (b.length === 13) variants[b.slice(1)] = true;
    if (b.length === 14) { variants[b.slice(1, -1)] = true; variants[b.slice(2, -1)] = true; }
    for (var v in variants) {
      if (v.length === a.length && v.length >= 10 && v.slice(0, -1) === a.slice(0, -1)) return 92;
      if (a.length === 11 && v.length >= 11 && v.slice(0, 10) === a.slice(0, 10)) return 90;
    }
    return 0;
  }
  function ndcComparable(stored, scanned) { return ndcMatchScore(stored, scanned) >= 90; }

  function normalizedLabel(v) { return String(v == null ? '' : v).toLowerCase().replace(/[^a-z0-9]/g, ''); }

  function pageText() { return String((document.body && document.body.innerText) || ''); }

  // Current NDC shown on the PIMS inventory result, if any.
  function currentResultNdc() {
    var m = pageText().match(/\bNDC\s*-\s*(\d{9,14})\b/i);
    return m ? m[1] : '';
  }

  // ---- PO reading (condensed from readIncomingPurchaseOrders) ---------------
  function incomingPurchasesRoot() {
    var headings = [].slice.call(document.querySelectorAll('h1,h2,h3,h4,h5,h6,div,span'))
      .filter(function (el) { return String(el.textContent || '').trim().toLowerCase() === 'incoming purchases'; });
    for (var i = 0; i < headings.length; i++) {
      var node = headings[i];
      for (var depth = 0; node && depth < 8; depth++, node = node.parentElement) {
        var text = String(node.innerText || '');
        if (/PO\s*Number/i.test(text) && /Receivable/i.test(text)) return node;
      }
    }
    return null;
  }

  function receivableValue(value) {
    var text = String(value || '').trim();
    var qty = Number((text.match(/[\d,]+/) || ['0'])[0].replace(/,/g, ''));
    return /\b(?:yes|true|open|receivable)\b/i.test(text) || (isFinite(qty) && qty > 0);
  }

  function readPurchaseOrders() {
    var root = incomingPurchasesRoot();
    if (!root) return [];
    var table = root.querySelector ? root.querySelector('table') : null;
    var choices = [];
    if (table) {
      var headerCells = [].slice.call(table.querySelectorAll('thead th'));
      if (!headerCells.length) headerCells = [].slice.call(table.querySelectorAll('tr:first-child th'));
      var headers = headerCells.map(function (th) { return normalizedLabel(th.innerText); });
      var poIndex = headers.findIndex(function (l) { return l.indexOf('ponumber') >= 0; });
      var recvIndex = headers.findIndex(function (l) { return l === 'receivable' || l.indexOf('receivable') >= 0; });
      if (poIndex >= 0) {
        [].slice.call(table.querySelectorAll('tbody tr')).forEach(function (row) {
          var cells = [].slice.call(row.querySelectorAll(':scope > th,:scope > td'));
          if (cells.length <= poIndex) return;
          var po = String(cells[poIndex].innerText || '').trim();
          if (!po || /nothing here/i.test(po)) return;
          var recvText = recvIndex >= 0 ? String((cells[recvIndex] || {}).innerText || '').trim() : '';
          if (recvIndex >= 0 && !receivableValue(recvText)) return;
          var target = cells[poIndex].querySelector('a[href],button,[role="link"],[role="button"]') ||
            row.querySelector('a[href],button,[role="link"],[role="button"]') || row;
          choices.push({ po: po, receivable: recvText || 'YES', target: target });
        });
      }
    }
    if (!choices.length) {
      // Fallback: Cloudscape grid without a semantic table.
      [].slice.call(root.querySelectorAll('a[href],button,[role="link"],[role="button"]')).forEach(function (target) {
        var po = String(target.innerText || target.textContent || '').trim();
        if (!/^(?=.*[A-Z])(?=.*\d)[A-Z0-9-]{6,}$/i.test(po)) return;
        var row = target.closest('tr,[role="row"]') || target.parentElement;
        var rowText = String((row && row.innerText) || target.innerText || '').trim();
        var recvText = (rowText.match(/\b(?:YES|TRUE|OPEN|RECEIVABLE)\b/i) || [''])[0];
        choices.push({ po: po, receivable: recvText || 'YES', target: target });
      });
    }
    // De-dupe by PO number.
    return choices.filter(function (c, i, arr) { return arr.findIndex(function (o) { return o.po === c.po; }) === i; });
  }

  // ---- PIMS field driving (condensed from sendLastScanToPage) ---------------
  function isVisible(el) {
    if (!el) return false;
    var s = window.getComputedStyle(el), r = el.getBoundingClientRect();
    return s.display !== 'none' && s.visibility !== 'hidden' && r.width > 0 && r.height > 0;
  }

  // Type a value into the active/first PIMS input and press Enter (used to run
  // the NDC search exactly like a wedge scan would on the raw page).
  function setPimsSearch(value) {
    var inputs = [].slice.call(document.querySelectorAll('input,textarea')).filter(isVisible);
    var input = inputs.find(function (el) {
      var p = (el.getAttribute('placeholder') || el.getAttribute('aria-label') || '').toLowerCase();
      return /scan a package|enter an ndc|medication name|search/.test(p);
    }) || inputs.find(function (el) { return !el.disabled && !el.readOnly; });
    if (!input) return false;
    var proto = input.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
    var setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    ['keydown', 'keyup'].forEach(function (type) {
      input.dispatchEvent(new KeyboardEvent(type, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
    });
    return true;
  }

  // ---------------------------------------------------------------------------
  // State machine
  // ---------------------------------------------------------------------------
  var STEP = { NDC: 1, PO: 2, MED: 3, LOC: 4 };
  var state = {
    step: STEP.NDC,
    ndc: '',          // confirmed NDC from step 1
    drug: '',
    po: null,         // chosen PO { po, receivable }
    buffer: '',       // wedge scan buffer
    lastKeyAt: 0,
    timer: null,
    poPollTimer: null,
    poPollTries: 0
  };

  // ---------------------------------------------------------------------------
  // Overlay DOM
  // ---------------------------------------------------------------------------
  var root = document.createElement('div');
  root.id = 'ptx7-rx-root';
  root.style.cssText = [
    'position:fixed', 'inset:0', 'z-index:2147483647', 'display:none',
    'font-family:Arial,Helvetica,sans-serif', 'background:#ffffff', 'color:#172b3a',
    'overflow:auto', '-webkit-text-size-adjust:100%'
  ].join(';');

  var STYLE = document.createElement('style');
  STYLE.textContent =
    '#ptx7-rx-root *{box-sizing:border-box}' +
    '#ptx7-rx-bar{display:flex;align-items:center;height:58px;background:#007A83;color:#fff;padding:0 12px}' +
    '#ptx7-rx-bar .back{background:transparent;border:0;color:#fff;font-size:16px;font-weight:900;padding:8px}' +
    '#ptx7-rx-bar .title{flex:1;text-align:center;font-size:22px;font-weight:900;letter-spacing:.5px}' +
    '#ptx7-rx-bar .spacer{width:64px}' +
    '#ptx7-rx-dots{display:flex;justify-content:center;gap:26px;padding:12px 0 4px}' +
    '.ptx7-rx-dot{width:20px;height:20px;border-radius:50%;background:#cdd5db;color:#59636b;font:900 13px Arial;display:flex;align-items:center;justify-content:center}' +
    '.ptx7-rx-dot.on{background:#007A83;color:#fff}' +
    '#ptx7-rx-body{padding:4px 20px 24px;max-width:560px;margin:0 auto}' +
    '.ptx7-rx-step{text-align:center;color:#59636b;font-weight:900;font-size:15px;margin:8px 0 2px}' +
    '.ptx7-rx-head{text-align:center;color:#172b3a;font-weight:900;font-size:20px;margin:2px 0 2px}' +
    '.ptx7-rx-sub{text-align:center;color:#59636b;font-size:15px;margin:2px 0 10px}' +
    '.ptx7-rx-scanbox{border:4px solid #007A83;border-radius:18px;padding:22px 10px;text-align:center;margin:12px 0}' +
    '.ptx7-rx-scanbox .glyph{font-size:40px;letter-spacing:4px}' +
    '.ptx7-rx-scanbox .label{color:#007A83;font-weight:900;font-size:21px;margin-top:8px}' +
    '.ptx7-rx-btn{display:block;width:100%;border:0;border-radius:16px;padding:20px;margin:10px 0;font:900 22px Arial;cursor:pointer}' +
    '.ptx7-rx-btn.primary{background:#007A83;color:#fff}' +
    '.ptx7-rx-btn.ghost{background:#fff;color:#005A61;border:3px solid #cdd5db}' +
    '.ptx7-rx-btn.wait{background:#eceff2;color:#59636b}' +
    '.ptx7-rx-btn .meta{display:block;font-size:14px;font-weight:700;margin-top:4px}' +
    '.ptx7-rx-po{background:#fff;color:#007A83;border:3px solid #007A83}' +
    '.ptx7-rx-confirm{border-radius:14px;padding:14px;margin:12px 0;text-align:center;font-weight:900}' +
    '.ptx7-rx-confirm.ok{background:#e6f6eb;border:2px solid #087f3f;color:#087f3f}' +
    '.ptx7-rx-confirm.bad{background:#fff1f0;border:2px solid #b42318;color:#b42318}' +
    '.ptx7-rx-confirm .meta{display:block;color:#172b3a;font-weight:700;font-size:15px;margin-top:4px}' +
    '.ptx7-rx-success{background:#087f3f;color:#fff;border-radius:18px;padding:26px 14px;text-align:center;margin:12px 0}' +
    '.ptx7-rx-success .big{font-size:34px;font-weight:900}' +
    '.ptx7-rx-success .loc{font-size:26px;font-weight:900;margin-top:8px}' +
    '.ptx7-rx-success .drug{font-size:16px;margin-top:6px}' +
    '#ptx7-rx-foot{position:sticky;bottom:0;background:#f6f8f9;text-align:center;color:#59636b;font-size:13px;padding:12px}';
  root.appendChild(STYLE);

  var bar = document.createElement('div');
  bar.id = 'ptx7-rx-bar';
  bar.innerHTML = '<button class="back" type="button" id="ptx7-rx-back">\u2039 PIMS</button>' +
    '<div class="title">RECEIVING</div><div class="spacer"></div>';
  root.appendChild(bar);

  var dots = document.createElement('div');
  dots.id = 'ptx7-rx-dots';
  dots.innerHTML = [1, 2, 3, 4].map(function (n) { return '<div class="ptx7-rx-dot" data-n="' + n + '">' + n + '</div>'; }).join('');
  root.appendChild(dots);

  var body = document.createElement('div');
  body.id = 'ptx7-rx-body';
  root.appendChild(body);

  var foot = document.createElement('div');
  foot.id = 'ptx7-rx-foot';
  foot.textContent = 'Built-in scanner active \u00b7 camera off';
  root.appendChild(foot);

  (document.body || document.documentElement).appendChild(root);

  // ---------------------------------------------------------------------------
  // Audio feedback (Web Audio, no assets)
  // ---------------------------------------------------------------------------
  var audioCtx = null;
  function tone(ok) {
    try {
      var Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      audioCtx = audioCtx || new Ctx();
      if (audioCtx.state === 'suspended') audioCtx.resume();
      var seq = ok ? [[1320, 0, 0.09], [1760, 0.11, 0.18]] : [[300, 0, 0.22], [180, 0.24, 0.34]];
      var t0 = audioCtx.currentTime + 0.02;
      seq.forEach(function (n) {
        var osc = audioCtx.createOscillator(), g = audioCtx.createGain();
        osc.type = ok ? 'square' : 'sawtooth';
        osc.frequency.setValueAtTime(n[0], t0 + n[1]);
        g.gain.setValueAtTime(0.0001, t0 + n[1]);
        g.gain.exponentialRampToValueAtTime(0.3, t0 + n[1] + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + n[1] + n[2]);
        osc.connect(g); g.connect(audioCtx.destination);
        osc.start(t0 + n[1]); osc.stop(t0 + n[1] + n[2] + 0.03);
      });
    } catch (e) {}
  }

  // ---------------------------------------------------------------------------
  // Rendering per step
  // ---------------------------------------------------------------------------
  function setDots() {
    [].slice.call(dots.children).forEach(function (el) {
      var n = Number(el.getAttribute('data-n'));
      el.classList.toggle('on', n <= state.step);
    });
  }

  function scanBox(label) {
    return '<div class="ptx7-rx-scanbox"><div class="glyph">|||\u2009||\u2009|\u2009|||</div>' +
      '<div class="label">' + esc(label) + '</div></div>';
  }
  function exitBtn() { return '<button class="ptx7-rx-btn ghost" type="button" id="ptx7-rx-exit">\u2190 EXIT TO PIMS</button>'; }

  function render() {
    setDots();
    var h = '';
    if (state.step === STEP.NDC) {
      foot.textContent = 'Built-in scanner active \u00b7 camera off';
      h += '<div class="ptx7-rx-step">STEP 1 OF 4</div>';
      h += '<div class="ptx7-rx-head">Scan the medication NDC</div>';
      h += scanBox('SCAN NDC');
      h += '<div class="ptx7-rx-sub">Point the scanner at the NDC barcode and pull the trigger.</div>';
      h += '<button class="ptx7-rx-btn wait" type="button" disabled>WAITING FOR SCAN\u2026</button>';
      h += exitBtn();
    } else if (state.step === STEP.PO) {
      foot.textContent = 'Tap a PO to continue';
      h += '<div class="ptx7-rx-step">STEP 2 OF 4</div>';
      h += '<div class="ptx7-rx-head">NDC ' + esc(state.ndc) + '</div>';
      h += '<div class="ptx7-rx-sub">Tap the correct purchase order.</div>';
      var pos = readPurchaseOrders();
      if (!pos.length) {
        h += '<div class="ptx7-rx-confirm bad">No receivable POs found for this NDC yet.' +
          '<span class="meta">Waiting for PIMS\u2026 or scan a different NDC.</span></div>';
      } else {
        pos.forEach(function (p, i) {
          h += '<button class="ptx7-rx-btn ptx7-rx-po" type="button" data-po="' + i + '">' +
            esc(p.po) + '<span class="meta">Receivable: ' + esc(p.receivable) + '</span></button>';
        });
      }
      state._pos = pos;
      h += exitBtn();
    } else if (state.step === STEP.MED) {
      foot.textContent = 'Mismatch plays an error tone';
      h += '<div class="ptx7-rx-step">STEP 3 OF 4</div>';
      h += '<div class="ptx7-rx-head">PO ' + esc(state.po ? state.po.po : '') + '</div>';
      h += '<div class="ptx7-rx-sub">Scan the medication to confirm.</div>';
      h += scanBox('SCAN MEDICATION');
      h += '<div id="ptx7-rx-medmsg"></div>';
      h += exitBtn();
    } else if (state.step === STEP.LOC) {
      foot.textContent = 'Returns to Step 1 automatically';
      h += '<div class="ptx7-rx-step">STEP 4 OF 4</div>';
      h += '<div class="ptx7-rx-head">Scan the shelf location</div>';
      h += scanBox('SCAN LOCATION');
      h += '<div id="ptx7-rx-locmsg"></div>';
      h += exitBtn();
    }
    body.innerHTML = h;
    wire();
  }

  function wire() {
    var exit = document.getElementById('ptx7-rx-exit');
    if (exit) exit.onclick = function () { window.__ptx7Rx.close(); };
    [].slice.call(body.querySelectorAll('[data-po]')).forEach(function (btn) {
      btn.onclick = function () {
        var p = (state._pos || [])[Number(btn.getAttribute('data-po'))];
        if (p) choosePo(p);
      };
    });
  }

  function showSuccess(location) {
    foot.textContent = 'Returns to Step 1 automatically';
    body.innerHTML =
      '<div class="ptx7-rx-step">COMPLETE</div>' +
      '<div class="ptx7-rx-success"><div class="big">\u2713 PUT AWAY</div>' +
      '<div class="loc">' + esc(location) + '</div>' +
      '<div class="drug">' + esc(state.drug || ('NDC ' + state.ndc)) + '</div></div>' +
      '<button class="ptx7-rx-btn primary" type="button" id="ptx7-rx-next">RECEIVE NEXT NDC</button>' +
      exitBtn();
    document.getElementById('ptx7-rx-next').onclick = resetToNdc;
    var exit = document.getElementById('ptx7-rx-exit');
    if (exit) exit.onclick = function () { window.__ptx7Rx.close(); };
  }

  // ---------------------------------------------------------------------------
  // Step transitions
  // ---------------------------------------------------------------------------
  function resetToNdc() {
    state.step = STEP.NDC; state.ndc = ''; state.drug = ''; state.po = null;
    render();
  }

  function onNdcScan(raw) {
    var ndc = digitsOnly(raw);
    if (ndc.length < 9) { tone(false); flashMsg('Not a valid NDC. Scan again.'); return; }
    state.ndc = currentResultNdc() || ndc;
    tone(true);
    // Drive the PIMS search so the Incoming Purchases table populates, then
    // advance to PO selection and poll briefly for the async result.
    setPimsSearch(raw);
    state.step = STEP.PO;
    render();
    pollForPos();
  }

  function pollForPos() {
    clearInterval(state.poPollTimer); state.poPollTries = 0;
    state.poPollTimer = setInterval(function () {
      state.poPollTries++;
      if (state.step !== STEP.PO) { clearInterval(state.poPollTimer); return; }
      var ndcNow = currentResultNdc();
      if (ndcNow) state.ndc = ndcNow;
      var pos = readPurchaseOrders();
      if (pos.length || state.poPollTries > 20) { clearInterval(state.poPollTimer); render(); }
    }, 400);
  }

  function choosePo(p) {
    state.po = p; tone(true);
    // Navigate PIMS into the PO (prefer a real link; fall back to click).
    try {
      var fresh = readPurchaseOrders().find(function (x) { return x.po === p.po; });
      var target = (fresh && fresh.target) || p.target;
      var anchor = target && (target.matches && target.matches('a[href]') ? target :
        (target.querySelector && target.querySelector('a[href]')) || (target.closest && target.closest('a[href]')));
      if (anchor && anchor.href) { location.assign(anchor.href); }
      else if (target && target.click) { target.click(); }
    } catch (e) {}
    state.step = STEP.MED;
    render();
  }

  function onMedScan(raw) {
    var msg = document.getElementById('ptx7-rx-medmsg');
    var score = ndcMatchScore(state.ndc, raw);
    if (ndcComparable(state.ndc, raw)) {
      tone(true);
      if (msg) msg.innerHTML = '<div class="ptx7-rx-confirm ok">\u2713 MATCHES PO' +
        '<span class="meta">' + esc(state.drug || ('NDC ' + state.ndc)) + '</span></div>';
      state.step = STEP.LOC;
      setTimeout(render, 650);
    } else {
      tone(false);
      if (msg) msg.innerHTML = '<div class="ptx7-rx-confirm bad">\u2717 WRONG MEDICATION' +
        '<span class="meta">Scanned does not match NDC ' + esc(state.ndc) + ' (' + score + '%)</span></div>';
    }
  }

  function onLocScan(raw) {
    var loc = String(raw || '').trim().toUpperCase();
    if (!/^(?:MAN|CLD)/.test(loc)) {
      tone(false);
      var m = document.getElementById('ptx7-rx-locmsg');
      if (m) m.innerHTML = '<div class="ptx7-rx-confirm bad">\u2717 NOT A LOCATION BARCODE' +
        '<span class="meta">' + esc(loc) + '</span></div>';
      return;
    }
    // Type the location into PIMS and submit, mirroring the raw-page flow.
    setPimsSearch(raw);
    tone(true);
    showSuccess(loc);
    // Auto-return to step 1 for the next item.
    setTimeout(function () { if (state.step === STEP.LOC) resetToNdc(); }, 2500);
  }

  function flashMsg(text) {
    var el = body.querySelector('.ptx7-rx-sub');
    if (el) el.textContent = text;
  }

  // ---------------------------------------------------------------------------
  // Wedge scanner capture (only while overlay is open)
  // ---------------------------------------------------------------------------
  function handleScan(scanned) {
    scanned = String(scanned || '').trim();
    if (!scanned) return;
    if (state.step === STEP.NDC) onNdcScan(scanned);
    else if (state.step === STEP.MED) onMedScan(scanned);
    else if (state.step === STEP.LOC) onLocScan(scanned);
    // Step PO is tap-only; ignore scans there.
  }

  function onKeyDown(e) {
    if (root.style.display !== 'block') return;
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    var isChar = e.key && e.key.length === 1;
    var isTerm = e.key === 'Enter' || e.key === 'Tab';
    if (!isChar && !isTerm) return;
    e.preventDefault(); e.stopPropagation();
    if (e.stopImmediatePropagation) e.stopImmediatePropagation();
    var now = (performance && performance.now) ? performance.now() : Date.now();
    if (now - state.lastKeyAt > 180) state.buffer = '';
    state.lastKeyAt = now;
    if (isTerm) {
      var s = state.buffer; state.buffer = ''; clearTimeout(state.timer);
      if (s) handleScan(s);
      return;
    }
    state.buffer += e.key;
    clearTimeout(state.timer);
    // Fallback for imagers that do not send Enter: close on a short pause.
    state.timer = setTimeout(function () {
      var s = state.buffer; state.buffer = '';
      if (s) handleScan(s);
    }, 180);
  }
  window.addEventListener('keydown', onKeyDown, true);

  document.getElementById('ptx7-rx-back').onclick = function () { window.__ptx7Rx.close(); };

  // ---------------------------------------------------------------------------
  // Public bridge used by the Android host
  // ---------------------------------------------------------------------------
  window.__ptx7Rx = {
    open: function () {
      window.__ptx7RxReopen = false;
      resetToNdc();
      root.style.display = 'block';
      window.scrollTo(0, 0);
    },
    close: function () {
      root.style.display = 'none';
      clearInterval(state.poPollTimer);
      if (window.PTX7Host && window.PTX7Host.onReceivingClosed) {
        try { window.PTX7Host.onReceivingClosed(); } catch (e) {}
      }
    },
    isOpen: function () { return root.style.display === 'block'; }
  };

  if (window.__ptx7RxReopen) window.__ptx7Rx.open();
})();
