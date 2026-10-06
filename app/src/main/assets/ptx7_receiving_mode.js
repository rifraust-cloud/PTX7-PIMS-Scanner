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

  // ---------------------------------------------------------------------------
  // NDC resolution (ported from the PTX7 Apps Script Exception tool, which has
  // field-proven UPC/GS1/GTIN handling). Turns a raw scan into a canonical
  // 11-digit NDC so Step 1 (NDC capture) and Step 3 (medication match) are
  // reliable regardless of UPC/GTIN packaging and check digits.
  // ---------------------------------------------------------------------------

  // UPC-A drug barcode: 3 + 10-digit NDC payload + UPC check digit.
  // Example 300021495800 -> payload 0002149580 -> NDC-11 00002149580.
  function deriveNdcFromUpcDrugBarcode(barcode) {
    var d = digitsOnly(barcode);
    var ndc10 = '';
    if (d.length === 12 && d.charAt(0) === '3') ndc10 = d.slice(1, 11);
    if (!ndc10 && d.length === 13 && d.slice(0, 2) === '03') ndc10 = d.slice(2, 12);
    if (ndc10.length !== 10) return '';
    return '0' + ndc10.slice(0, 4) + ndc10.slice(4, 8) + ndc10.slice(8, 10);
  }

  function deriveNdcFromGtin(gtin) {
    var d = digitsOnly(gtin);
    if (d.length !== 14) return '';
    // Many pharmacy GTIN-14 values are 00 + UPC-A drug barcode.
    if (d.slice(0, 2) === '00') {
      var fromUpc = deriveNdcFromUpcDrugBarcode(d.slice(2, 14));
      if (fromUpc) return fromUpc;
    }
    var candidates = [d.slice(2, 13), d.slice(1, 12), d.slice(3, 14), d.slice(0, 11)];
    for (var i = 0; i < candidates.length; i++) {
      if (/^\d{11}$/.test(candidates[i])) return candidates[i];
    }
    return '';
  }

  // Resolve any raw NDC/UPC/GTIN form to a canonical 11-digit NDC.
  function resolveNdc11(raw) {
    var cleaned = String(raw == null ? '' : raw).trim();

    // Dashed NDC: segment lengths tell us the exact padding.
    var dash = cleaned.match(/^(\d+)-(\d+)-(\d+)$/);
    if (dash) {
      var s1 = dash[1], s2 = dash[2], s3 = dash[3];
      var total = s1.length + s2.length + s3.length;
      if (total === 11) return s1 + s2 + s3;
      if (total === 10) {
        if (s1.length === 4) return '0' + s1 + s2 + s3;      // 4-4-2
        if (s2.length === 3) return s1 + '0' + s2 + s3;      // 5-3-2
        if (s3.length === 1) return s1 + s2 + '0' + s3;      // 5-4-1
      }
    }

    var d = digitsOnly(cleaned);
    if (!d) return '';
    if (d.length === 11) return d;
    if (d.length === 9) return '00' + d; // recover zeros stripped elsewhere
    if (d.length === 10) return '0' + d.slice(0, 4) + d.slice(4, 8) + d.slice(8, 10); // default 4-4-2
    if (d.length === 12) { var u12 = deriveNdcFromUpcDrugBarcode(d); return u12 || d.slice(1); }
    if (d.length === 13) { var u13 = deriveNdcFromUpcDrugBarcode(d); return u13 || d.slice(2); }
    if (d.length === 14) return deriveNdcFromGtin(d);
    return '';
  }

  // Compact GS1 (01=GTIN, 21=serial, 17=exp, 10=lot) with no separators.
  // Returns the embedded NDC-11 if present.
  function ndcFromCompactGs1(raw) {
    var s = String(raw == null ? '' : raw).replace(/\s+/g, '').replace(/\|/g, '');
    var m = s.match(/^01(\d{14})/);
    if (!m) return '';
    return deriveNdcFromGtin(m[1]);
  }

  // All plausible canonical NDC-11 forms for a raw scan (handles the ambiguous
  // undashed 10-digit case by trying 4-4-2 / 5-3-2 / 5-4-1).
  function ndc11Variants(raw) {
    var out = [];
    var seen = {};
    function add(v) {
      v = digitsOnly(v);
      if (v && v.length === 11 && !seen[v]) { seen[v] = true; out.push(v); }
    }
    add(resolveNdc11(raw));
    add(ndcFromCompactGs1(raw));
    var d = digitsOnly(raw);
    if (d.length === 10) {
      add('0' + d.slice(0, 4) + d.slice(4, 8) + d.slice(8, 10)); // 4-4-2
      add(d.slice(0, 5) + '0' + d.slice(5, 8) + d.slice(8, 10)); // 5-3-2
      add(d.slice(0, 5) + d.slice(5, 9) + '0' + d.slice(9, 10)); // 5-4-1
    }
    return out;
  }

  // Primary helper: the single best canonical NDC-11 for a scan (or '').
  function scanToNdc11(raw) {
    var v = ndc11Variants(raw);
    return v.length ? v[0] : '';
  }

  // Match a scanned barcode against a known/stored NDC using canonical NDC-11
  // on both sides. Returns a 0..100 confidence score.
  function ndcMatchScore(stored, scanned) {
    var storedForms = ndc11Variants(stored);
    var scanForms = ndc11Variants(scanned);
    if (!storedForms.length || !scanForms.length) {
      // Fall back to raw digit equality if neither side resolves to NDC-11.
      var a = digitsOnly(stored), b = digitsOnly(scanned);
      if (a && b && a === b) return 100;
      if (a && b && (a.indexOf(b) >= 0 || b.indexOf(a) >= 0)) return 90;
      return 0;
    }
    for (var i = 0; i < storedForms.length; i++) {
      for (var j = 0; j < scanForms.length; j++) {
        if (storedForms[i] === scanForms[j]) return 100;
      }
    }
    // Same 10-digit product prefix, differing package digit.
    for (var x = 0; x < storedForms.length; x++) {
      for (var y = 0; y < scanForms.length; y++) {
        if (storedForms[x].slice(0, 10) === scanForms[y].slice(0, 10)) return 92;
      }
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

  // The drug name heading on the PIMS inventory result (e.g.
  // "Xiromed Progesterone 100 Mg Cap (bottle, 100.0 Capsules)").
  function currentResultDrug() {
    var hs = [].slice.call(document.querySelectorAll('h1,h2,h3,h4,[role="heading"]'))
      .filter(function (el) { return !(el.closest && el.closest('#ptx7-rx-root')); })
      .map(function (el) { return String(el.textContent || '').replace(/\s+/g, ' ').trim(); })
      .filter(function (t) {
        return t && !/^inventory$/i.test(t) && !/incoming purchases|transaction history/i.test(t);
      });
    return hs[0] || '';
  }

  // ---- PO receiving-page readers -------------------------------------------
  // These read the live PIMS "Receiving" page so the overlay can mirror it.

  // The PO number heading (e.g. "3XX63W4G") and status line.
  function currentPo() {
    var t = pageText();
    // Status: OPEN RECEIVABLE appears right under the PO heading.
    var m = t.match(/\b([A-Z0-9]{6,10})\s+Status:\s*(OPEN|CLOSED|NOT STARTED)/i);
    if (m) return m[1];
    // Fallback: a short heading near "Status: ... RECEIVABLE".
    var hs = [].slice.call(document.querySelectorAll('h1,h2,h3'))
      .filter(function (el) { return !(el.closest && el.closest('#ptx7-rx-root')); })
      .map(function (el) { return String(el.textContent || '').trim(); })
      .filter(function (s) { return /^[A-Z0-9]{6,10}$/.test(s); });
    return hs[0] || '';
  }

  // "Receiving in progress: 48/110" -> { received, total } if present.
  function currentProgress() {
    var m = pageText().match(/Receiving in progress:\s*(\d+)\s*\/\s*(\d+)/i);
    return m ? { received: m[1], total: m[2] } : null;
  }

  // When a drug has been scanned on the receiving page, PIMS shows a detail
  // panel that says "Scan Location to submit receives" with the drug, NDC, and
  // Suggested Locations. Returns that info, or null when no drug is pending.
  function currentReceiveDetail() {
    var t = pageText();
    // Detect the "waiting for location" state via either the panel header or
    // the modal prompt PIMS shows after a drug scan.
    if (!/Scan Location to submit receives/i.test(t) &&
        !/Complete receive before proceeding to next NDC/i.test(t)) return null;
    var ndc = (t.match(/NDC:\s*(\d{9,14})/i) || [])[1] || '';
    // Prefer a real location-code match (MANFW0102-D-11 / CLDxxxx-x-xx), which
    // is unambiguous; fall back to the labeled "Suggested Locations:" text.
    var loc = (t.match(/\b((?:MAN(?:FW|WS)?|CLD)[A-Z]*\d{3,5}-[A-Z]-\d{1,2})\b/i) || [])[1] || '';
    if (!loc) {
      loc = (t.match(/Suggested Locations?:\s*([A-Z0-9\-\/ ]+)/i) || [])[1] || '';
      loc = loc.trim().split(/\s{2,}/)[0].trim();
    }
    loc = loc.toUpperCase();
    // Drug heading: the detail panel repeats the drug name near the NDC.
    var drug = '';
    var dm = t.match(/([A-Z][A-Za-z0-9][^\n]*?\((?:bottle|box|container|tube|each)[^\n]*?\))\s*NDC:/i);
    if (dm) drug = dm[1].trim();
    return { ndc: ndc, drug: drug, location: loc };
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

  // Type a value into the PIMS Inventory search box and submit, so the
  // "Incoming Purchases" PO table populates for the scanned NDC.
  function setPimsSearch(value) {
    var inputs = [].slice.call(document.querySelectorAll('input,textarea')).filter(function (el) {
      // Never target our own overlay's capture/inputs.
      if (el.closest && el.closest('#ptx7-rx-root')) return false;
      return isVisible(el);
    });
    var input = inputs.find(function (el) {
      var p = (el.getAttribute('placeholder') || el.getAttribute('aria-label') || '').toLowerCase();
      return /scan a package|enter an ndc|dispensable product|medication name|search/.test(p);
    }) || inputs.find(function (el) { return !el.disabled && !el.readOnly; });
    if (!input) return false;
    var proto = input.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
    var setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));

    // Prefer clicking the real Submit button (Cloudscape forms often ignore a
    // bare Enter key); fall back to dispatching Enter on the input.
    var submitBtn = [].slice.call(document.querySelectorAll('button,input[type=submit],[role="button"]'))
      .filter(function (b) { return !(b.closest && b.closest('#ptx7-rx-root')) && isVisible(b); })
      .find(function (b) {
        var t = String(b.innerText || b.value || b.getAttribute('aria-label') || '').trim().toLowerCase();
        return t === 'submit' || t === 'search';
      });
    if (submitBtn) {
      submitBtn.click();
    } else {
      ['keydown', 'keyup'].forEach(function (type) {
        input.dispatchEvent(new KeyboardEvent(type, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
      });
    }
    return true;
  }

  // ---------------------------------------------------------------------------
  // State machine
  // ---------------------------------------------------------------------------
  // State for the persistent receive-mirror surface. Receiving itself is done
  // by PIMS underneath; this overlay forwards scans to PIMS and mirrors PIMS's
  // state in a big, simple UI. The operator stays here until Return to PIMS.
  var state = {
    phase: 'NDC',       // 'NDC' (scan to look up) | 'PO' (select) | 'RECEIVE'
    ndc: '',            // NDC searched
    drug: '',           // drug name from PIMS result
    pos: [],            // PO choices for the scanned NDC
    poPollTimer: null,
    poPollTries: 0,
    buffer: '',
    lastKeyAt: 0,
    timer: null,
    captureTimer: null,
    mirrorTimer: null,
    lastSignature: ''
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
    '#ptx7-rx-root{font-size:20px}' +
    '#ptx7-rx-bar{display:flex;align-items:center;min-height:64px;background:#007A83;color:#fff;padding:10px 14px}' +
    '#ptx7-rx-bar .back{background:rgba(255,255,255,.18);border:0;color:#fff;font-size:18px;font-weight:900;padding:14px 16px;border-radius:12px}' +
    '#ptx7-rx-bar .title{flex:1;text-align:center;font-size:30px;font-weight:900;letter-spacing:1px}' +
    '#ptx7-rx-bar .spacer{width:70px}' +
    '#ptx7-rx-dots{display:none}' +
    '#ptx7-rx-body{padding:16px 20px 28px;max-width:none;margin:0}' +
    '.ptx7-rx-step{text-align:center;color:#59636b;font-weight:900;font-size:20px;letter-spacing:1px;margin:10px 0 6px}' +
    '.ptx7-rx-head{text-align:center;color:#172b3a;font-weight:900;font-size:34px;line-height:1.15;margin:8px 0}' +
    '.ptx7-rx-sub{text-align:center;color:#59636b;font-size:20px;margin:6px 0 16px}' +
    '.ptx7-rx-scanbox{border:6px solid #007A83;border-radius:22px;padding:34px 14px;text-align:center;margin:20px 0}' +
    '.ptx7-rx-scanbox .glyph{font-size:60px;letter-spacing:8px}' +
    '.ptx7-rx-scanbox .label{color:#007A83;font-weight:900;font-size:32px;margin-top:14px}' +
    // Giant primary buttons: tall, chunky, easy to hit.
    '.ptx7-rx-btn{display:block;width:100%;border:0;border-radius:20px;padding:28px 18px;margin:18px 0;font-weight:900;font-size:30px;cursor:pointer;line-height:1.1}' +
    '.ptx7-rx-btn.primary{background:#007A83;color:#fff;box-shadow:0 6px 0 #005a61}' +
    '.ptx7-rx-btn.ghost{background:#fff;color:#005A61;border:4px solid #cdd5db}' +
    '.ptx7-rx-btn.wait{background:#eceff2;color:#59636b;font-size:24px}' +
    '.ptx7-rx-btn .meta{display:block;font-size:18px;font-weight:800;margin-top:8px;opacity:.9}' +
    '.ptx7-rx-po{background:#fff;color:#007A83;border:4px solid #007A83}' +
    '.ptx7-rx-confirm{border-radius:18px;padding:22px 16px;margin:18px 0;text-align:center;font-weight:900;font-size:26px}' +
    '.ptx7-rx-confirm.ok{background:#e6f6eb;border:3px solid #087f3f;color:#087f3f}' +
    '.ptx7-rx-confirm.bad{background:#fff1f0;border:3px solid #b42318;color:#b42318}' +
    '.ptx7-rx-confirm .meta{display:block;color:#172b3a;font-weight:700;font-size:18px;margin-top:8px}' +
    '.ptx7-rx-success{background:#087f3f;color:#fff;border-radius:22px;padding:34px 16px;text-align:center;margin:20px 0}' +
    '.ptx7-rx-success .big{font-size:44px;font-weight:900}' +
    '.ptx7-rx-success .loc{font-size:40px;font-weight:900;margin-top:14px;letter-spacing:1px}' +
    '.ptx7-rx-success .drug{font-size:22px;margin-top:12px}' +
    '#ptx7-rx-foot{position:sticky;bottom:0;background:#f6f8f9;text-align:center;color:#59636b;font-size:15px;padding:12px 14px}';
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

  // Hidden-but-focused capture input. The PM86 wedge commits scanned text into
  // whatever editable field is focused (this is how it filled Notes). The
  // Receiving screen has no visible input, so we keep this one focused to catch
  // the scan. Positioned off to a 1px corner and transparent, but NOT
  // display:none (which would make it unfocusable).
  var capture = document.createElement('input');
  capture.id = 'ptx7-rx-capture';
  capture.type = 'text';
  capture.setAttribute('autocomplete', 'off');
  capture.setAttribute('autocorrect', 'off');
  capture.setAttribute('autocapitalize', 'off');
  capture.setAttribute('spellcheck', 'false');
  capture.setAttribute('inputmode', 'none'); // discourage the soft keyboard
  capture.style.cssText = [
    'position:absolute', 'left:0', 'top:0', 'width:1px', 'height:1px',
    'opacity:0.01', 'border:0', 'padding:0', 'margin:0', 'background:transparent',
    'color:transparent', 'caret-color:transparent', 'z-index:1'
  ].join(';');
  root.appendChild(capture);

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


  // Hide the step-dots row; this flow is a continuous scan loop, not 4 steps.
  dots.style.display = 'none';

  function setDebug(text) { foot.textContent = text; }

  function scanBox(label) {
    return '<div class="ptx7-rx-scanbox"><div class="glyph">|||\u2009||\u2009|\u2009|||</div>' +
      '<div class="label">' + esc(label) + '</div></div>';
  }

  // ---------------------------------------------------------------------------
  // Mirror the live PIMS receiving page in a big, simple UI.
  //
  // The operator stays here and just scans. PIMS underneath does the real
  // receiving; we forward each scan to PIMS and reflect its state:
  //   - No drug pending  -> big "SCAN MEDICATION"
  //   - Drug pending     -> big "SCAN LOCATION" + suggested location + drug
  //   - After submit     -> brief success, then back to "SCAN MEDICATION"
  // ---------------------------------------------------------------------------
  function render() {
    var h = '';

    if (state.phase === 'NDC') {
      // Phase 1: scan an NDC to look up its purchase orders.
      h += '<div class="ptx7-rx-step">STEP 1 \u00b7 FIND PO</div>';
      h += '<div class="ptx7-rx-head">Scan a medication NDC</div>';
      h += scanBox('SCAN NDC');
      h += '<div class="ptx7-rx-sub">Scan an NDC to look up its purchase orders.</div>';

    } else if (state.phase === 'PO') {
      // Phase 2: pick the correct PO from the lookup.
      h += '<div class="ptx7-rx-step">STEP 2 \u00b7 SELECT PO</div>';
      h += '<div class="ptx7-rx-head">' + esc(state.drug || ('NDC ' + state.ndc)) + '</div>';
      h += '<div class="ptx7-rx-sub">Tap the correct purchase order.</div>';
      if (!state.pos.length) {
        h += '<div class="ptx7-rx-confirm bad">Looking up purchase orders\u2026' +
          '<span class="meta">If none appear, scan the NDC again.</span></div>';
      } else {
        state.pos.forEach(function (p, i) {
          h += '<button class="ptx7-rx-btn ptx7-rx-po" type="button" data-po="' + i + '">' +
            esc(p.po) + '<span class="meta">Receivable: ' + esc(p.receivable) + '</span></button>';
        });
      }
      h += '<button class="ptx7-rx-btn wait" type="button" id="ptx7-rx-rescan">SCAN A DIFFERENT NDC</button>';

    } else {
      // Phase 3: receive loop inside the PO. Mirror the live PIMS state.
      var po = currentPo();
      var prog = currentProgress();
      var detail = currentReceiveDetail();
      h += '<div class="ptx7-rx-step">' + (po ? 'PO ' + esc(po) : 'RECEIVING') +
        (prog ? ' \u00b7 ' + esc(prog.received) + '/' + esc(prog.total) : '') + '</div>';
      if (detail) {
        h += '<div class="ptx7-rx-head">Scan this location</div>';
        h += '<div class="ptx7-rx-success"><div class="loc">' +
          esc(detail.location || 'SEE PIMS') + '</div>' +
          '<div class="drug">' + esc(detail.drug || ('NDC ' + detail.ndc)) + '</div></div>';
        h += scanBox('SCAN LOCATION');
        h += '<div class="ptx7-rx-sub">Scan the shelf location to submit this receive.</div>';
      } else {
        h += '<div class="ptx7-rx-head">Scan a medication</div>';
        h += scanBox('SCAN MEDICATION');
        h += '<div class="ptx7-rx-sub">Scan each item, then its location. Stays in this PO.</div>';
      }
    }

    h += '<button class="ptx7-rx-btn ghost" type="button" id="ptx7-rx-exit">\u2190 RETURN TO PIMS</button>';

    body.innerHTML = h;

    var exit = document.getElementById('ptx7-rx-exit');
    if (exit) exit.onclick = function () { window.__ptx7Rx.close(); };
    var rescan = document.getElementById('ptx7-rx-rescan');
    if (rescan) rescan.onclick = function () { startNdcPhase(); };
    [].slice.call(body.querySelectorAll('[data-po]')).forEach(function (btn) {
      btn.onclick = function () {
        var p = state.pos[Number(btn.getAttribute('data-po'))];
        if (p) choosePo(p);
      };
    });

    if (root.style.display === 'block') {
      setTimeout(function () {
        try { capture.focus({ preventScroll: true }); } catch (e) { try { capture.focus(); } catch (e2) {} }
      }, 20);
    }
  }

  function startNdcPhase() {
    clearInterval(state.poPollTimer);
    state.phase = 'NDC'; state.ndc = ''; state.drug = ''; state.pos = [];
    render();
  }

  // Scan an NDC -> drive the PIMS Inventory search -> read Incoming Purchases.
  function onNdcScan(raw) {
    tone(true);
    setDebug('NDC scan: ' + raw);
    state.phase = 'PO'; state.pos = [];
    state.ndc = scanToNdc11(raw) || digitsOnly(raw);
    setPimsSearch(raw);                 // drive PIMS Inventory search + Submit
    render();
    clearInterval(state.poPollTimer); state.poPollTries = 0;
    state.poPollTimer = setInterval(function () {
      state.poPollTries++;
      if (state.phase !== 'PO') { clearInterval(state.poPollTimer); return; }
      var ndcNow = currentResultNdc(); if (ndcNow) state.ndc = ndcNow;
      var drugNow = currentResultDrug(); if (drugNow) state.drug = drugNow;
      var pos = readPurchaseOrders();
      if (pos.length) { state.pos = pos; clearInterval(state.poPollTimer); render(); }
      else if (state.poPollTries > 20) { clearInterval(state.poPollTimer); render(); }
      else if (state.poPollTries % 3 === 0) { render(); }
    }, 400);
  }

  function choosePo(p) {
    tone(true);
    setDebug('PO: ' + p.po);
    // Open the PO's receiving page (prefer a real link; fall back to click).
    try {
      var fresh = readPurchaseOrders().find(function (x) { return x.po === p.po; });
      var target = (fresh && fresh.target) || p.target;
      var anchor = target && (target.matches && target.matches('a[href]') ? target :
        (target.querySelector && target.querySelector('a[href]')) || (target.closest && target.closest('a[href]')));
      if (anchor && anchor.href) { location.assign(anchor.href); }
      else if (target && target.click) { target.click(); }
    } catch (e) {}
    state.phase = 'RECEIVE';
    state.lastSignature = '';
    setTimeout(render, 400);
    setTimeout(render, 1200);
  }

  // Continuously mirror PIMS during the RECEIVE phase so the big UI tracks the
  // live page (drug scanned, location submitted) without leaving Receive Mode.
  function startMirror() {
    clearInterval(state.mirrorTimer);
    state.mirrorTimer = setInterval(function () {
      if (root.style.display !== 'block') return;
      if (state.phase !== 'RECEIVE') return; // NDC/PO phases manage their own UI
      var detail = currentReceiveDetail();
      var sig = currentPo() + '|' + (detail ? (detail.ndc + '|' + detail.location) : 'idle');
      if (sig !== state.lastSignature) {
        state.lastSignature = sig;
        render();
      }
    }, 500);
  }

  // ---------------------------------------------------------------------------
  // Forward a captured scan into the PIMS page.
  //
  // PIMS has its own global scan listener on the receiving page (a Zebra just
  // scans and PIMS reacts). So we replay the scanned characters as key events
  // into the document, then Enter, letting PIMS handle the drug/location.
  // ---------------------------------------------------------------------------
  function forwardScanToPims(scanned) {
    var target = document.body || document.documentElement;
    for (var i = 0; i < scanned.length; i++) {
      var ch = scanned.charAt(i);
      var code = scanned.charCodeAt(i);
      ['keydown', 'keypress', 'keyup'].forEach(function (type) {
        var ev;
        try {
          ev = new KeyboardEvent(type, {
            key: ch, bubbles: true, cancelable: true,
            keyCode: code, which: code, charCode: (type === 'keypress' ? code : 0)
          });
        } catch (e) { return; }
        target.dispatchEvent(ev);
      });
    }
    ['keydown', 'keypress', 'keyup'].forEach(function (type) {
      var ev;
      try {
        ev = new KeyboardEvent(type, {
          key: 'Enter', code: 'Enter', keyCode: 13, which: 13,
          bubbles: true, cancelable: true
        });
      } catch (e) { return; }
      target.dispatchEvent(ev);
    });
  }

  function handleScan(scanned) {
    scanned = String(scanned || '').trim();
    if (!scanned) return;
    setDebug('Scan: ' + scanned);
    if (state.phase === 'NDC') {
      onNdcScan(scanned);
    } else if (state.phase === 'RECEIVE') {
      // Inside a PO: forward the drug/location scan to PIMS's own listener.
      tone(true);
      forwardScanToPims(scanned);
      setTimeout(render, 300);
      setTimeout(render, 900);
    } else {
      // PO selection is tap-only; nudge the operator.
      tone(false);
      setDebug('Tap the correct PO above (or SCAN A DIFFERENT NDC).');
    }
  }

  // ---------------------------------------------------------------------------
  // Focused capture input (the PM86 wedge commits text into a focused field).
  // ---------------------------------------------------------------------------
  // PIMS injects a wide (1800px) layout viewport, which shrinks our overlay
  // when the browser scales the page down to the phone. While Receive Mode is
  // open, switch the page viewport to device-width so the overlay renders at
  // true phone scale; restore PIMS's viewport on close. PIMS reflows beneath
  // us, which is fine — the mirror re-reads the page on a timer.
  var savedViewportContent = null;
  function getViewportMeta() {
    var m = document.querySelector('meta[name="viewport"]');
    if (!m) {
      m = document.createElement('meta');
      m.name = 'viewport';
      (document.head || document.documentElement).appendChild(m);
    }
    return m;
  }
  function scaleToScreen() {
    var m = getViewportMeta();
    if (savedViewportContent === null) savedViewportContent = m.getAttribute('content') || '';
    m.setAttribute('content', 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no');
    // Large base font; element sizes are in px and already big at phone scale.
    root.style.fontSize = '20px';
  }
  function restoreViewport() {
    if (savedViewportContent !== null) {
      var m = getViewportMeta();
      m.setAttribute('content', savedViewportContent);
      savedViewportContent = null;
    }
  }

  function focusCapture() {
    if (root.style.display !== 'block') return;
    try { capture.focus({ preventScroll: true }); } catch (e) { try { capture.focus(); } catch (e2) {} }
  }
  capture.addEventListener('blur', function () {
    if (root.style.display === 'block') setTimeout(focusCapture, 10);
  });
  root.addEventListener('click', function () { setTimeout(focusCapture, 0); });
  capture.addEventListener('input', function () {
    setDebug('Scanning: ' + capture.value);
    clearTimeout(state.captureTimer);
    state.captureTimer = setTimeout(function () {
      var s = capture.value.trim(); capture.value = '';
      if (s) handleScan(s);
    }, 160);
  });
  capture.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      clearTimeout(state.captureTimer);
      var s = capture.value.trim(); capture.value = '';
      if (s) handleScan(s);
    }
  });

  document.getElementById('ptx7-rx-back').onclick = function () { window.__ptx7Rx.close(); };

  // ---------------------------------------------------------------------------
  // Public bridge used by the Android host
  // ---------------------------------------------------------------------------
  window.__ptx7Rx = {
    open: function () {
      window.__ptx7RxReopen = false;
      root.style.display = 'block';
      state.phase = 'NDC'; state.ndc = ''; state.drug = ''; state.pos = [];
      state.lastSignature = '';
      capture.value = '';
      try { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); } catch (e) {}
      window.scrollTo(0, 0);
      scaleToScreen();
      render();
      startMirror();
      setTimeout(focusCapture, 50);
      setTimeout(focusCapture, 300);
    },
    close: function () {
      root.style.display = 'none';
      clearInterval(state.mirrorTimer);
      clearInterval(state.poPollTimer);
      restoreViewport();
      if (window.PTX7Host && window.PTX7Host.onReceivingClosed) {
        try { window.PTX7Host.onReceivingClosed(); } catch (e) {}
      }
    },
    isOpen: function () { return root.style.display === 'block'; },
    // Native host path: Android captured a full hardware-wedge scan and hands
    // it to us. Forward it into PIMS and mirror.
    onHostScan: function (scanned) {
      if (root.style.display !== 'block') return;
      handleScan(String(scanned || ''));
    },
    onHostScanDiag: function (scanned, diag) {
      setDebug('SCAN ' + String(scanned || '') + '  ' + String(diag || ''));
    }
  };

  if (window.__ptx7RxReopen) window.__ptx7Rx.open();
})();
