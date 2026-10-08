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

  // Shorten a full location code for the big display:
  // MANFW0103-J-04 -> 103-J-04 ; CLDFW0101-A-02 -> 101-A-02.
  function shortLoc(full) {
    var m = String(full || '').toUpperCase().match(/(?:MAN(?:FW|WS)?|CLD[A-Z]*)0*(\d{2,4})-([A-Z])-(\d{1,2})/);
    if (m) return m[1] + '-' + m[2] + '-' + m[3];
    return String(full || '');
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

  // True when PIMS is showing a PO receiving page (not the Inventory lookup).
  // Markers seen on that page: "Receiving in progress", the Unreceived/Received
  // tabs, "Search by Product Id", "Manually Receive Item", or a PO + Status.
  function onReceivingPage() {
    var t = pageText();
    if (/Receiving in progress/i.test(t)) return true;
    if (/Manually Receive Item/i.test(t)) return true;
    if (/Unreceived\s*\d+\s*\/\s*\d+/i.test(t)) return true;
    if (/Back to all Purchase Orders/i.test(t)) return true;
    if (/Scan Location to submit receives/i.test(t)) return true;
    return false;
  }

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

  // Find the active receiving dialog (role="dialog" with the confirmed marker),
  // excluding our overlay.
  function activeReceivePanel() {
    var marker = /Complete receive before proceeding to next NDC|Scan Location to submit receives/i;
    var dialogs = [].slice.call(document.querySelectorAll('[role="dialog"],[role="alertdialog"]'))
      .filter(function (d) { return !(d.closest && d.closest('#ptx7-rx-root')); });
    for (var i = 0; i < dialogs.length; i++) {
      if (marker.test(dialogs[i].textContent || '')) return dialogs[i];
    }
    return null;
  }

  function allLocationsIn(text) {
    var set = {};
    (String(text || '').toUpperCase().match(/\b(?:MAN(?:FW|WS)?|CLD[A-Z]*)\d{3,5}-[A-Z]-\d{1,2}\b/g) || [])
      .forEach(function (l) { set[l] = true; });
    return Object.keys(set);
  }

  function parsePair(s) {
    var m = String(s || '').match(/(\d+)\s*\((\d+)\)/);
    return m ? { pkgs: Number(m[1]), units: Number(m[2]) } : null;
  }

  // Map a table's rows by header text. Returns array of {header:cellText}.
  function readTableByHeaders(table) {
    if (!table) return [];
    var heads = [].slice.call(table.querySelectorAll('thead th'));
    if (!heads.length) heads = [].slice.call(table.querySelectorAll('tr:first-child th,tr:first-child td'));
    var keys = heads.map(function (h) { return String(h.innerText || '').replace(/\s+/g, ' ').trim().toLowerCase(); });
    var rows = [];
    [].slice.call(table.querySelectorAll('tbody tr')).forEach(function (tr) {
      var cells = [].slice.call(tr.querySelectorAll(':scope > td,:scope > th'));
      if (!cells.length) return;
      var row = {};
      cells.forEach(function (c, i) { row[keys[i] || ('col' + i)] = c; });
      rows.push(row);
    });
    return rows;
  }

  // Find the side panel row for an NDC and read a labeled "<label>: a (b)".
  function panelPairByLabel(scopeText, label) {
    var re = new RegExp(label + '\\s*:?\\s*(\\d+)\\s*\\((\\d+)\\)', 'i');
    var m = scopeText.match(re);
    return m ? { pkgs: Number(m[1]), units: Number(m[2]) } : null;
  }

  // Read the active receiving dialog + NDC-matched side panel, binding ONE
  // coherent pending item. Returns null until a coherent snapshot is readable.
  function currentReceiveDetail() {
    var dialog = activeReceivePanel();
    if (!dialog) return null;

    // 1) Scanned Items table in the dialog (map by headers).
    var tables = [].slice.call(dialog.querySelectorAll('table'));
    var rowObjs = [];
    tables.forEach(function (tb) { rowObjs = rowObjs.concat(readTableByHeaders(tb)); });
    // The pending row is the one with a Product Id + Currently Scanned.
    var pend = null;
    for (var i = 0; i < rowObjs.length; i++) {
      var r = rowObjs[i];
      var pidCell = r['product id'] || r['productid'] || r['product'];
      if (pidCell && /\d{6,}/.test(pidCell.innerText || '')) { pend = r; break; }
    }
    if (!pend) return null;

    var productId = (((pend['product id'] || pend['productid'] || pend['product']).innerText) || '').replace(/\D/g, '');
    var descCell = pend['description'] || pend['desc'];
    var drug = descCell ? String(descCell.innerText || '').replace(/\s+/g, ' ').trim() : '';
    var scannedCell = pend['currently scanned'] || pend['scanned'];
    var scanned = scannedCell ? parsePair(scannedCell.innerText) : null;
    var locCell = pend['suggested locations'] || pend['suggested location'] || pend['locations'];
    var locations = locCell ? allLocationsIn(locCell.innerText) : [];
    // If the dialog cell had no codes, fall back to the dialog's own text.
    if (!locations.length) locations = allLocationsIn(dialog.innerText);

    // 2) Side panel matched by NDC == productId.
    var ordered = null, received = null, pkgSize = 0, warnings = [], unitWord = 'units';
    var panels = [].slice.call(document.querySelectorAll('[role="dialog"],aside,section,div'))
      .filter(function (el) {
        if (el.closest && el.closest('#ptx7-rx-root')) return false;
        if (el === dialog) return false;
        var txt = el.innerText || '';
        return productId && txt.indexOf(productId) >= 0 && /Quantity (Ordered|Received)/i.test(txt);
      })
      .sort(function (a, b) { return (a.innerText || '').length - (b.innerText || '').length; });
    var sp = panels[0];
    if (sp) {
      var st = (sp.innerText || '').replace(/\u00a0/g, ' ');
      ordered = panelPairByLabel(st, 'Quantity Ordered');
      received = panelPairByLabel(st, 'Quantity Received');
      var psz = st.match(/Package Size\s*:?\s*(\d+(?:\.\d+)?)/i);
      if (psz) pkgSize = Math.round(Number(psz[1]));
      if (/hazardous drug|special handling|N\s*Listed Hazard/i.test(st)) warnings.push('HAZARDOUS \u2014 Special Handling');
      if (/cold chain|refrigerat/i.test(st)) warnings.push('COLD CHAIN');
      var uw = st.match(/\d+\.?\d*\s*(Capsules?|Tablets?|Milliliters?|mL|Grams?|Each|Units?|Inhalers?|Sprays?)/i);
      if (uw) unitWord = uw[1];
      if (!drug) {
        var dd = st.match(/([A-Z0-9][^\n]*?\((?:bottle|box|container|tube|each|carton)[^\n]*?\))/i);
        if (dd) drug = dd[1].replace(/\s+/g, ' ').trim();
      }
    }
    if (!pkgSize && scanned && scanned.pkgs > 0) pkgSize = Math.round(scanned.units / scanned.pkgs);

    // Require a coherent snapshot: product id present (and, when a side panel
    // exists, its NDC matched). Otherwise return null -> "Loading item details".
    if (!productId) return null;

    return {
      ndc: productId, drug: drug,
      location: locations[0] || '',
      locations: locations,
      ordered: ordered, received: received, scanned: scanned,
      pkgSize: pkgSize, unitWord: String(unitWord).toLowerCase(),
      warnings: warnings,
      key: productId
    };
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
    phase: 'HOME',      // 'HOME' | 'NDC' | 'PO' | 'RECEIVE'
    ndc: '',            // NDC searched
    drug: '',           // drug name from PIMS result
    pos: [],            // PO choices for the scanned NDC
    poPollTimer: null,
    poPollTries: 0,
    releaseFocus: false,   // diagnostic: when true, don't steal focus/deliver
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
    // Compact header: back / title / settings.
    '#ptx7-rx-bar{display:flex;align-items:center;min-height:64px;background:#007A83;color:#fff;padding:8px 12px}' +
    '#ptx7-rx-bar .back,#ptx7-rx-bar .gear{background:rgba(255,255,255,.16);border:0;color:#fff;font-size:22px;font-weight:900;width:52px;height:52px;border-radius:12px}' +
    '#ptx7-rx-bar .title{flex:1;text-align:center;font-size:26px;font-weight:900;letter-spacing:1px}' +
    '#ptx7-rx-dots{display:none}' +
    '#ptx7-rx-body{padding:16px 16px 28px;max-width:none;margin:0}' +
    '.ptx7-rx-step{text-align:center;color:#59636b;font-weight:900;font-size:20px;letter-spacing:1px;margin:8px 0 4px}' +
    '.ptx7-rx-po{color:#172b3a;font-weight:900;font-size:20px;margin:2px 0 10px}' +
    '.ptx7-rx-head{text-align:center;color:#172b3a;font-weight:900;font-size:32px;line-height:1.15;margin:8px 0}' +
    '.ptx7-rx-sub{text-align:center;color:#59636b;font-size:19px;margin:6px 0 14px}' +
    // Home tile.
    '#ptx7-rx-home-tile{display:flex;flex-direction:column;align-items:center;justify-content:center;' +
      'background:#007A83;color:#fff;border-radius:24px;padding:52px 16px;margin:18px 0;min-height:360px;cursor:pointer;box-shadow:0 8px 0 #005a61}' +
    '#ptx7-rx-home-tile .icon{font-size:120px;line-height:1}' +
    '#ptx7-rx-home-tile .lbl{font-size:40px;font-weight:900;letter-spacing:2px;margin-top:16px}' +
    '#ptx7-rx-home-tile .hint{font-size:18px;opacity:.9;margin-top:6px}' +
    // Medication card.
    '.ptx7-rx-card{background:#fff;border:2px solid #cdd5db;border-radius:18px;padding:16px 18px;margin:12px 0}' +
    '.ptx7-rx-card .name{font-size:28px;font-weight:900;color:#172b3a;line-height:1.1}' +
    '.ptx7-rx-card .ndc{font-size:17px;color:#59636b;margin-top:2px}' +
    '.ptx7-rx-card .count{text-align:center;font-size:34px;font-weight:900;color:#087f3f;margin:12px 0 4px}' +
    '.ptx7-rx-card .bottles{text-align:center;font-size:18px;color:#59636b;margin-bottom:10px}' +
    '.ptx7-rx-barwrap{height:22px;border-radius:11px;background:#e6eaee;overflow:hidden;margin:4px 0 2px}' +
    '.ptx7-rx-bar2{height:100%;border-radius:11px;background:#087f3f;width:2%}' +
    '.ptx7-rx-pending{margin-top:12px;border-radius:12px;background:#fff8e5;border:2px solid #d99b00;' +
      'color:#8a5a00;font-weight:900;font-size:20px;text-align:center;padding:12px}' +
    // Big scan box.
    '.ptx7-rx-scanbox{border:6px solid #007A83;border-radius:22px;padding:28px 14px;text-align:center;margin:16px 0}' +
    '.ptx7-rx-scanbox .glyph{font-size:52px;letter-spacing:8px}' +
    '.ptx7-rx-scanbox .label{color:#007A83;font-weight:900;font-size:28px;margin-top:10px}' +
    // Buttons (>=72dp tall ~ 72px).
    '.ptx7-rx-btn{display:block;width:100%;border:0;border-radius:18px;padding:0 18px;min-height:76px;margin:14px 0;font-weight:900;font-size:26px;cursor:pointer;line-height:1.1}' +
    '.ptx7-rx-btn.primary{background:#007A83;color:#fff;box-shadow:0 6px 0 #005a61}' +
    '.ptx7-rx-btn.ghost{background:#fff;color:#005A61;border:4px solid #cdd5db}' +
    '.ptx7-rx-btn.wait{background:#eceff2;color:#59636b;font-size:22px;min-height:64px}' +
    '.ptx7-rx-btn .meta{display:block;font-size:17px;font-weight:800;margin-top:6px;opacity:.9}' +
    '.ptx7-rx-po-btn{background:#fff;color:#007A83;border:4px solid #007A83}' +
    // Location card (big).
    '.ptx7-rx-loccard{background:#087f3f;color:#fff;border-radius:22px;padding:22px 16px;text-align:center;margin:14px 0}' +
    '.ptx7-rx-loccard .cue{font-size:18px;letter-spacing:1px;color:#dff2e6}' +
    '.ptx7-rx-loccard .short{font-size:60px;font-weight:900;line-height:1.05;margin:6px 0}' +
    '.ptx7-rx-loccard .full{font-size:22px;font-weight:900;color:#e6f5ea}' +
    '.ptx7-rx-loccard .meds{font-size:18px;color:#e6f5ea;margin-top:8px}' +
    '.ptx7-rx-warn{margin-top:12px;border-radius:12px;background:#fff8e5;border:2px solid #d99b00;color:#8a5a00;font-weight:900;font-size:18px;text-align:center;padding:10px}' +
    '.ptx7-rx-confirm{border-radius:18px;padding:20px 16px;margin:14px 0;text-align:center;font-weight:900;font-size:24px}' +
    '.ptx7-rx-confirm.ok{background:#e6f6eb;border:3px solid #087f3f;color:#087f3f}' +
    '.ptx7-rx-confirm.bad{background:#fff1f0;border:3px solid #b42318;color:#b42318}' +
    '.ptx7-rx-confirm .meta{display:block;color:#172b3a;font-weight:700;font-size:17px;margin-top:6px}' +
    '#ptx7-rx-foot{position:sticky;bottom:0;background:#f6f8f9;text-align:center;color:#59636b;font-size:14px;padding:10px 12px}';
  root.appendChild(STYLE);

  var bar = document.createElement('div');
  bar.id = 'ptx7-rx-bar';
  bar.innerHTML = '<button class="back" type="button" id="ptx7-rx-back" aria-label="Back">\u2039</button>' +
    '<div class="title">Receiving</div>' +
    '<button class="gear" type="button" id="ptx7-rx-gear" aria-label="Settings">\u2699</button>';
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

  // ---- Location voice (ported pronunciation from v2.26.1) -------------------
  var VOICE_ON_KEY = 'ptx7_rx_voice_on';
  var VOICE_NAME_KEY = 'ptx7_rx_voice_name';
  var VOICE_RATE_KEY = 'ptx7_rx_voice_rate';
  function voiceEnabled() {
    try { return localStorage.getItem(VOICE_ON_KEY) !== 'false'; } catch (e) { return true; }
  }
  function voiceRate() {
    var v = 1; try { v = Number(localStorage.getItem(VOICE_RATE_KEY) || 1); } catch (e) {}
    return [0.85, 1, 1.15, 1.3].indexOf(v) >= 0 ? v : 1;
  }
  function availableVoices() {
    if (!('speechSynthesis' in window)) return [];
    return window.speechSynthesis.getVoices().filter(function (v) { return /^en(-|_)/i.test(v.lang || ''); });
  }
  function selectedVoice() {
    var vs = availableVoices();
    var saved = ''; try { saved = localStorage.getItem(VOICE_NAME_KEY) || ''; } catch (e) {}
    if (saved) { var ex = vs.find(function (v) { return v.name === saved || v.voiceURI === saved; }); if (ex) return ex; }
    var pref = /Sonia|Libby|Hazel|Zira|Female|Google UK English Female/i;
    return vs.find(function (v) { return pref.test(v.name); }) ||
      vs.find(function (v) { return /^en-GB/i.test(v.lang); }) || vs[0] || null;
  }
  // Pronounce a location like "one zero three, J, four".
  function spokenLocation(loc) {
    var u = String(loc || '').toUpperCase();
    var digitWords = ['zero','one','two','three','four','five','six','seven','eight','nine'];
    var small = digitWords.concat(['ten','eleven','twelve','thirteen','fourteen','fifteen','sixteen','seventeen','eighteen','nineteen','twenty']);
    var m = u.match(/^((?:MAN|CLD)[A-Z]*)0*(\d{3})-([A-Z])-(\d{1,2})$/);
    if (m) {
      var prefix = m[1].indexOf('CLD') === 0 ? 'Cold, ' : (m[1].indexOf('MANWS') === 0 ? 'Workstation, ' : '');
      var secDigits = m[2].split('').map(function (d) { return digitWords[Number(d)]; }).join(' ');
      var pos = Number(m[4]); var posWord = (pos >= 0 && pos < small.length) ? small[pos] : String(pos);
      return prefix + secDigits + ', ' + m[3] + ', ' + posWord;
    }
    return u.replace(/^CLD[A-Z]*/, 'Cold, ').replace(/^MANWS/, 'Workstation, ').replace(/^MANFW/, '').replace(/-/g, ', ');
  }
  function speakLocation(loc, force) {
    try {
      if (!('speechSynthesis' in window)) return;
      if (!force && !voiceEnabled()) return;
      window.speechSynthesis.cancel();  // cancel outdated speech
      var u = new SpeechSynthesisUtterance(spokenLocation(loc));
      u.rate = voiceRate();
      var v = selectedVoice(); if (v) u.voice = v;
      window.speechSynthesis.speak(u);
    } catch (e) {}
  }
  function speakPhrase(text, force) {
    try {
      if (!('speechSynthesis' in window)) return;
      if (!force && !voiceEnabled()) return;
      window.speechSynthesis.cancel();
      var u = new SpeechSynthesisUtterance(String(text || ''));
      u.rate = voiceRate();
      var v = selectedVoice(); if (v) u.voice = v;
      window.speechSynthesis.speak(u);
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
    var showExit = true;

    if (state.phase === 'HOME') {
      showExit = false;
      h += '<div class="ptx7-rx-sub">Select a workflow</div>';
      h += '<div id="ptx7-rx-home-tile" role="button">' +
        '<div class="icon">\uD83D\uDCE6</div>' +
        '<div class="lbl">RECEIVING</div>' +
        '<div class="hint">Tap to begin</div></div>';

    } else if (state.phase === 'NDC') {
      h += '<div class="ptx7-rx-step">STEP 1 \u00b7 FIND PO</div>';
      h += '<div class="ptx7-rx-head">Scan a medication NDC</div>';
      h += scanBox('SCAN NDC');
      h += '<div class="ptx7-rx-sub">Scan an NDC to look up its purchase orders.</div>';

    } else if (state.phase === 'PO') {
      h += '<div class="ptx7-rx-step">STEP 2 \u00b7 SELECT PO</div>';
      h += '<div class="ptx7-rx-head">' + esc(state.drug || ('NDC ' + state.ndc)) + '</div>';
      h += '<div class="ptx7-rx-sub">Tap the correct purchase order.</div>';
      if (!state.pos.length) {
        h += '<div class="ptx7-rx-confirm bad">Looking up purchase orders\u2026' +
          '<span class="meta">If none appear, scan the NDC again.</span></div>';
      } else {
        state.pos.forEach(function (p, i) {
          h += '<button class="ptx7-rx-btn ptx7-rx-po-btn" type="button" data-po="' + i + '">' +
            esc(p.po) + '<span class="meta">Receivable: ' + esc(p.receivable) + '</span></button>';
        });
      }
      h += '<button class="ptx7-rx-btn wait" type="button" id="ptx7-rx-rescan">SCAN A DIFFERENT NDC</button>';

    } else { // RECEIVE
      var po = currentPo();
      var prog = currentProgress();
      var detail = currentReceiveDetail();
      h += '<div class="ptx7-rx-po">' + (po ? 'PO ' + esc(po) : 'Receiving') +
        (prog ? '  \u00b7  ' + esc(prog.received) + '/' + esc(prog.total) + ' PO' : '') + '</div>';

      if (detail) {
        // Waiting for location to submit this item.
        var locs = (detail.locations && detail.locations.length) ? detail.locations
          : (detail.location ? [detail.location] : []);
        h += '<div class="ptx7-rx-step">SCAN LOCATION</div>';
        // Per-item pending progress (scanned, not yet submitted).
        h += itemProgressCard(detail, 'pending');
        if (locs.length === 0) {
          h += '<div class="ptx7-rx-loccard" style="background:#b42318">' +
            '<div class="short" style="font-size:34px">Locations unavailable</div>' +
            '<div class="full">View PIMS to continue</div>' +
            '<div class="meds">' + esc(detail.drug || ('NDC ' + detail.ndc)) + '</div></div>';
        } else if (locs.length === 1) {
          h += '<div class="ptx7-rx-loccard">' +
            '<div class="cue">SCAN THIS LOCATION</div>' +
            '<div class="short">' + esc(shortLoc(locs[0])) + '</div>' +
            '<div class="full">' + esc(locs[0]) + '</div>' +
            '<div class="meds">' + esc(detail.drug || ('NDC ' + detail.ndc)) + '</div></div>';
        } else {
          h += '<div class="ptx7-rx-sub" style="font-weight:900;color:#172b3a">' +
            esc(detail.drug || ('NDC ' + detail.ndc)) + '</div>';
          h += '<div class="ptx7-rx-sub">Multiple locations available \u2014 scan any one</div>';
          locs.forEach(function (L, i) {
            h += '<div class="ptx7-rx-loccard" style="padding:16px" data-loc="' + i + '">' +
              '<div class="short" style="font-size:46px">' + esc(shortLoc(L)) + '</div>' +
              '<div class="full">' + esc(L) + '</div></div>';
          });
        }
        if (detail.warnings && detail.warnings.length) {
          h += '<div class="ptx7-rx-warn">\u26A0 ' + esc(detail.warnings.join(' \u00b7 ')) + '</div>';
        }
        h += scanBox('SCAN LOCATION');
        h += '<button class="ptx7-rx-btn wait" type="button" id="ptx7-rx-repeat">\uD83D\uDD0A REPEAT LOCATION</button>';
        state._locs = locs;
      } else if (state.resolvingItem) {
        // A scan was just delivered; PIMS hasn't shown the item yet.
        h += '<div class="ptx7-rx-step">SCAN ITEM</div>';
        h += '<div class="ptx7-rx-card"><div class="count" style="color:#172b3a">Reading item\u2026</div>' +
          '<div class="bottles">Waiting for PIMS to confirm the scan</div></div>';
        h += scanBox('READING\u2026');
      } else {
        // Ready for next item: medication progress card.
        h += '<div class="ptx7-rx-step">SCAN ITEM</div>';
        h += medCard(prog);
        h += scanBox('SCAN ITEM');
      }
    }

    if (showExit) {
      h += '<button class="ptx7-rx-btn ghost" type="button" id="ptx7-rx-exit">VIEW PIMS</button>';
    }

    body.innerHTML = h;

    // Wiring
    var home = document.getElementById('ptx7-rx-home-tile');
    if (home) home.onclick = function () { startNdcPhase(); };
    var exit = document.getElementById('ptx7-rx-exit');
    if (exit) exit.onclick = function () { window.__ptx7Rx.close(); };
    var rescan = document.getElementById('ptx7-rx-rescan');
    if (rescan) rescan.onclick = function () { startNdcPhase(); };
    var repeat = document.getElementById('ptx7-rx-repeat');
    if (repeat) repeat.onclick = function () {
      var d = currentReceiveDetail();
      if (d && d.location) speakLocation(d.location, true);
    };
    [].slice.call(body.querySelectorAll('[data-po]')).forEach(function (btn) {
      btn.onclick = function () {
        var p = state.pos[Number(btn.getAttribute('data-po'))];
        if (p) choosePo(p);
      };
    });
    [].slice.call(body.querySelectorAll('[data-loc]')).forEach(function (card) {
      card.onclick = function () {
        var L = (state._locs || [])[Number(card.getAttribute('data-loc'))];
        if (L) speakLocation(L, true);
      };
    });

    // Report scan ownership to the native host (unchanged logic).
    try {
      if (window.PTX7Host && window.PTX7Host.setScanOwnership) {
        window.PTX7Host.setScanOwnership(assistantOwnsScan());
      }
    } catch (e) {}

    if (root.style.display === 'block' && assistantOwnsScan()) {
      setTimeout(function () {
        try { capture.focus({ preventScroll: true }); } catch (e) { try { capture.focus(); } catch (e2) {} }
      }, 20);
    } else {
      releaseFocusToPims();
    }
  }

  // Build the medication progress card from PIMS quantities (no hard-coding).

  // Per-item progress card. mode 'pending' = after scan, before location.
  // Uses PIMS values; never invents a denominator; shows packages and (when
  // package size is known) unit progress; distinguishes pending vs confirmed.
  function itemProgressCard(detail, mode) {
    var name = detail.drug || ('NDC ' + detail.ndc);
    var ord = detail.ordered;          // {pkgs, units} ordered
    var rec = detail.received;         // {pkgs, units} confirmed (updates after submit)
    var scn = detail.scanned;          // {pkgs, units} currently scanned (pending)
    var unit = detail.unitWord || 'units';

    var html = '<div class="ptx7-rx-card">' +
      '<div class="name">' + esc(name) + '</div>' +
      '<div class="ndc">NDC ' + esc(detail.ndc) + '</div>';

    // Package line.
    if (scn && ord) {
      html += '<div class="count">' + scn.pkgs + ' of ' + ord.pkgs + ' packages ' +
        (mode === 'pending' ? 'scanned' : 'received') + '</div>';
    } else if (scn && !ord) {
      html += '<div class="count">' + scn.pkgs + ' scanned</div>' +
        '<div class="bottles">Ordered quantity unavailable</div>';
    } else if (rec && ord) {
      html += '<div class="count">' + rec.pkgs + ' of ' + ord.pkgs + ' packages received</div>';
    }

    // Unit line (only when package size > 1, e.g. 100 capsules/bottle).
    if (ord && detail.pkgSize && detail.pkgSize > 1) {
      var confirmedUnits = rec ? rec.units : 0;
      var pendingUnits = scn ? scn.units : 0;
      var shown = (mode === 'pending') ? pendingUnits : confirmedUnits;
      html += '<div class="bottles">' + shown + ' / ' + ord.units + ' ' + esc(unit) +
        (mode === 'pending' ? ' pending' : ' confirmed') + '</div>';
    }

    // Progress bar on confirmed received vs ordered.
    if (ord && ord.units) {
      var frac = (rec ? rec.units : 0) / ord.units;
      html += '<div class="ptx7-rx-barwrap"><div class="ptx7-rx-bar2" style="width:' +
        Math.max(2, Math.min(100, Math.round(frac * 100))) + '%"></div></div>';
    }

    if (mode === 'pending') {
      html += '<div class="bottles" style="color:#8a5a00;font-weight:900">Scan location to submit</div>';
    }
    html += '</div>';
    return html;
  }
  function medCard(prog) {
    // Idle (no pending item): never present a previous medication as current.
    var last = state.lastMed;
    var html = '<div class="ptx7-rx-card">' +
      '<div class="count" style="color:#172b3a">Ready for next item</div>' +
      '<div class="bottles">Scan an item\u2019s 2D barcode to begin</div>' +
      (prog ? '<div class="bottles">PO progress ' + esc(prog.received) + '/' + esc(prog.total) + '</div>' : '') +
      '</div>';
    if (last && last.drug && last.received) {
      html += '<div class="ptx7-rx-card" style="border-style:dashed">' +
        '<div class="ndc" style="font-weight:900">LAST RECEIVED</div>' +
        '<div class="name" style="font-size:22px">' + esc(last.drug) + '</div>' +
        '<div class="bottles">' + last.received.pkgs + ' of ' + (last.ordered ? last.ordered.pkgs : '?') +
          ' packages confirmed</div></div>';
    }
    return html;
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
    // Persist intent so that when PIMS navigates to the PO receiving page and
    // this script re-injects on the fresh document, we auto-resume in RECEIVE.
    try { sessionStorage.setItem('ptx7_rx_resume', JSON.stringify({ po: p.po, at: Date.now() })); } catch (e) {}
    state.phase = 'RECEIVE';
    state.lastSignature = '';
    // Open the PO's receiving page (prefer a real link; fall back to click).
    try {
      var fresh = readPurchaseOrders().find(function (x) { return x.po === p.po; });
      var target = (fresh && fresh.target) || p.target;
      var anchor = target && (target.matches && target.matches('a[href]') ? target :
        (target.querySelector && target.querySelector('a[href]')) || (target.closest && target.closest('a[href]')));
      if (anchor && anchor.href) { location.assign(anchor.href); return; }
      else if (target && target.click) { target.click(); }
    } catch (e) {}
    // SPA click (no reload): render the receive screen now.
    setTimeout(render, 400);
    setTimeout(render, 1200);
  }

  // Continuously mirror PIMS. A page-driven watchdog keeps the phase correct:
  // once PIMS is on a PO receiving page, we must be in RECEIVE (so item scans
  // are released to PIMS, not treated as a new NDC lookup). This handles both
  // SPA navigation and full reloads regardless of the resume flag/timing.
  function startMirror() {
    clearInterval(state.mirrorTimer);
    state.mirrorTimer = setInterval(function () {
      if (root.style.display !== 'block') return;

      // Watchdog: sync phase to the page.
      if (onReceivingPage()) {
        if (state.phase !== 'RECEIVE') {
          state.phase = 'RECEIVE';
          state.lastSignature = '';
          try { sessionStorage.removeItem('ptx7_rx_resume'); } catch (e) {}
          render();   // render() also releases scan ownership to PIMS
        }
      }

      if (state.phase !== 'RECEIVE') return; // NDC/PO phases manage their own UI
      var detail = currentReceiveDetail();
      var prog = currentProgress();
      // Remember the current medication so the progress card can show it as
      // "Last received" after submission (labeled, never as current).
      if (detail && detail.drug) state.lastMed = detail;
      // Once PIMS reflects a pending item, we're no longer "reading".
      if (detail) { state.resolvingItem = false; clearTimeout(state.resolveTimer); }
      // Signature includes confirmed + pending quantities and ALL locations so
      // repeated scans of the SAME medication (count changes) still update.
      var qsig = detail ? ((detail.received ? detail.received.pkgs + '/' + detail.received.units : '') + '~' +
        (detail.scanned ? detail.scanned.pkgs + '/' + detail.scanned.units : '')) : '';
      var sig = currentPo() + '|' +
        (prog ? prog.received + '/' + prog.total : '?') + '|' +
        (detail ? (detail.key + '@' + (detail.locations || []).join(',') + '@' + qsig) : 'idle') + '|' +
        (state.resolvingItem ? 'resolving' : '');
      if (sig !== state.lastSignature) {
        var prev = state.lastSignature;
        state.lastSignature = sig;
        if (prev) {
          var wasPending = /@/.test(prev.split('|')[2] || '');
          var nowPending = !!detail;
          if (!wasPending && nowPending) tone(true);       // item accepted -> location
          else if (wasPending && !nowPending) tone(true);  // location submitted -> confirmed
        }
        // Announce location ONCE per change (multi vs single).
        var locKey = detail ? (detail.locations || []).join(',') : '';
        if (locKey && locKey !== state.lastSpokenLoc) {
          state.lastSpokenLoc = locKey;
          var locs = detail.locations || [];
          if (locs.length > 1) { speakPhrase('Multiple locations available', false); }
          else if (locs.length === 1) { speakLocation(locs[0], false); }
        }
        if (!detail) state.lastSpokenLoc = '';
        render();
      }
    }, 500);
  }

  // ---------------------------------------------------------------------------
  // Deliver a captured scan into PIMS.
  //
  // The PM86 does NOT deliver raw scans to the WebView unless a field is
  // focused, so we captured the scan ourselves. PIMS's receiving listener is
  // keystroke-based (a Zebra wedge works), so we must put the value into the
  // element PIMS listens on. Synthetic body key events are untrusted and
  // ignored, so instead we target an actual input: focus it, set its value via
  // the native setter (so React/Cloudscape sees it), fire 'input', then Enter.
  // ---------------------------------------------------------------------------

  // Enumerate real PIMS inputs (excluding our overlay), for delivery + probe.
  function pimsInputs() {
    return [].slice.call(document.querySelectorAll('input,textarea')).filter(function (el) {
      return !(el.closest && el.closest('#ptx7-rx-root'));
    });
  }

  // Best candidate input for a scan on the current PIMS page.
  function pimsScanInput() {
    var ins = pimsInputs();
    // 1) Whatever PIMS currently has focused.
    var active = document.activeElement;
    if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA') &&
        !(active.closest && active.closest('#ptx7-rx-root'))) return active;
    // 2) A visible search/scan box by placeholder/aria.
    var byPlaceholder = ins.filter(isVisible).find(function (el) {
      var p = (el.getAttribute('placeholder') || el.getAttribute('aria-label') || '').toLowerCase();
      return /scan|product id|enter an ndc|dispensable|medication name|search/.test(p);
    });
    if (byPlaceholder) return byPlaceholder;
    // 3) First enabled visible text input.
    return ins.filter(isVisible).find(function (el) { return !el.disabled && !el.readOnly; }) || null;
  }

  // Deliver the full barcode payload into PIMS by replaying it the way PIMS's
  // scanner listener expects (reverse-engineered via DevTools):
  //   - keypress events on `document` (it reads String.fromCharCode(e.which))
  //   - target must NOT be an INPUT/TEXTAREA/contenteditable (else ignored)
  //   - >= 6 chars, delivered FAST (elapsed first->last < len*30ms); a tight
  //     synchronous loop is ~0ms, well under the threshold
  //   - terminated by Enter (which=13)
  //   - full payload preserved (colons/control chars/serial/lot/exp)
  // No isTrusted requirement, so synthetic keypress events are accepted.
  function deliverScanToPims(payload) {
    // Ensure no editable element is the event target, or PIMS ignores it.
    try {
      var ae = document.activeElement;
      if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)) {
        ae.blur();
      }
    } catch (e) {}

    var target = document; // PIMS listens at the document level

    function fireKeypress(ch) {
      var code = ch.charCodeAt(0);
      var ev;
      try {
        ev = new KeyboardEvent('keypress', {
          key: ch, charCode: code, keyCode: code, which: code,
          bubbles: true, cancelable: true
        });
      } catch (e1) {
        // Fallback for engines that ignore the KeyboardEvent 'which' init.
        ev = document.createEvent('Event');
        ev.initEvent('keypress', true, true);
      }
      // Force which/keyCode in case the constructor dropped them (WebView).
      try {
        Object.defineProperty(ev, 'which', { get: function () { return code; } });
        Object.defineProperty(ev, 'keyCode', { get: function () { return code; } });
        Object.defineProperty(ev, 'charCode', { get: function () { return code; } });
      } catch (e2) {}
      target.dispatchEvent(ev);
    }

    // Fast synchronous burst = tiny elapsed time (passes len*30ms rule).
    for (var i = 0; i < payload.length; i++) fireKeypress(payload.charAt(i));
    // Terminator: Enter (which=13).
    fireKeypress(String.fromCharCode(13));

    return 'doc-keypress x' + payload.length;
  }

  // Diagnostic probe: list PIMS inputs so we can see what PIMS listens on.
  function probePimsInputs() {
    var ins = pimsInputs();
    if (!ins.length) return 'no PIMS inputs found';
    return ins.slice(0, 6).map(function (el, i) {
      var vis = isVisible(el) ? 'vis' : 'hid';
      var ph = el.getAttribute('placeholder') || el.getAttribute('aria-label') || el.id || el.name || el.tagName;
      var foc = (el === document.activeElement) ? '*FOCUSED*' : '';
      return (i + 1) + ':' + vis + ':' + ph + foc;
    }).join(' | ');
  }

  // Last captured scan (for diagnostics only; shows length + control chars, not
  // routinely logged elsewhere).
  var lastScanInfo = { len: 0, escaped: '', at: 0, method: '' };
  function escapeCtl(s) {
    return String(s || '').replace(/[\u0000-\u001f]/g, function (c) {
      return '<' + c.charCodeAt(0).toString(16).padStart(2, '0') + '>';
    });
  }

  // Build a copyable diagnostic report that identifies the failing layer.
  function buildDiagnostic() {
    var ae = document.activeElement;
    var aeDesc = ae ? ((ae.closest && ae.closest('#ptx7-rx-root')) ? 'overlay:' : 'pims:') +
      (ae.tagName + (ae.id ? '#' + ae.id : '') +
        (ae.getAttribute && ae.getAttribute('placeholder') ? '[' + ae.getAttribute('placeholder') + ']' : '')) : 'none';
    var detail = currentReceiveDetail();
    var prog = currentProgress();
    var lines = [
      'PTX7 Receive diagnostic',
      'script: v45-diag',
      'route: ' + location.pathname + location.search,
      'phase: ' + state.phase,
      'focusMode: ' + (state.releaseFocus ? 'RELEASED (scan goes to PIMS)' : 'CAPTURED (overlay input)'),
      'activeElement: ' + aeDesc,
      'currentPo: ' + (currentPo() || '(none)'),
      'progress: ' + (prog ? prog.received + '/' + prog.total : '(none)'),
      'receivePanel: ' + (detail ? ('ndc=' + detail.ndc + ' loc=' + detail.location + ' drug=' + (detail.drug || '')) : '(none)'),
      'pimsInputs: ' + probePimsInputs(),
      'lastScan: len=' + lastScanInfo.len + ' method=' + lastScanInfo.method +
        ' payload=' + lastScanInfo.escaped
    ];
    return lines.join('\n');
  }

  function handleScan(scanned) {
    scanned = String(scanned || '').trim();
    if (!scanned) return;
    lastScanInfo = { len: scanned.length, escaped: escapeCtl(scanned), at: Date.now(), method: '' };
    if (state.phase === 'NDC') {
      setDebug('NDC scan: ' + scanned.length + 'ch');
      onNdcScan(scanned);
    } else if (state.phase === 'RECEIVE') {
      // The PM86 only yields scan data via our focused input, so we capture it;
      // then replay the FULL payload as document keypress events the way PIMS's
      // scanner listener accepts (item scan OR location scan — PIMS decides
      // which based on its own receive state). Do NOT reduce to NDC.
      var method = deliverScanToPims(scanned);
      lastScanInfo.method = method;
      setDebug('deliver ' + scanned.length + 'ch via ' + method);
      // Show "Reading item…" until PIMS reflects the new item or location.
      state.resolvingItem = true;
      clearTimeout(state.resolveTimer);
      state.resolveTimer = setTimeout(function () { state.resolvingItem = false; render(); }, 2500);
      state.lastSignature = ''; // force the mirror to re-evaluate
      setTimeout(render, 300);
      setTimeout(render, 900);
      setTimeout(render, 1600);
    } else {
      // PO selection is tap-only.
      lastScanInfo.method = 'ignored (PO select is tap-only)';
      setDebug('Tap the correct PO above (or SCAN A DIFFERENT NDC).');
    }
  }

  // ---------------------------------------------------------------------------
  // Focused capture input (the PM86 wedge commits text into a focused field).
  // ---------------------------------------------------------------------------
  // NOTE: We previously switched the page viewport to device-width here to make
  // the overlay bigger, but that reflow broke the wedge capture focus. Reverted
  // to a no-op so the working scanner is preserved. Larger fixed fonts remain.
  function scaleToScreen() { /* intentionally no-op (do not touch viewport) */ }
  function restoreViewport() { /* no-op */ }

  // On the PM86 the scanner only yields data into a focused input, so the
  // assistant must capture during NDC lookup AND during RECEIVE. The crucial
  // detail (from the reverse-engineered PIMS listener): the capture input is
  // ONLY focused momentarily to receive the wedge text; delivery to PIMS is
  // then done via document keypress events with no editable target. During PO
  // selection the assistant does not own the scan (tap-only).
  function assistantOwnsScan() {
    if (state.releaseFocus) return false;        // diagnostic override
    return state.phase === 'NDC' || state.phase === 'RECEIVE';
  }
  function releaseFocusToPims() {
    try { if (document.activeElement === capture) capture.blur(); } catch (e) {}
  }

  function focusCapture() {
    if (root.style.display !== 'block') return;
    if (!assistantOwnsScan()) { releaseFocusToPims(); return; }
    try { capture.focus({ preventScroll: true }); } catch (e) { try { capture.focus(); } catch (e2) {} }
  }
  capture.addEventListener('blur', function () {
    if (root.style.display === 'block' && assistantOwnsScan()) setTimeout(focusCapture, 10);
  });
  root.addEventListener('click', function () { setTimeout(focusCapture, 0); });
  capture.addEventListener('input', function () {
    if (!assistantOwnsScan()) { capture.value = ''; return; }
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

  document.getElementById('ptx7-rx-back').onclick = function () {
    if (state.phase === 'NDC' || state.phase === 'PO') { startHome(); }
    else { window.__ptx7Rx.close(); }
  };
  document.getElementById('ptx7-rx-gear').onclick = function () { openSettings(); };

  function startHome() {
    clearInterval(state.poPollTimer);
    state.phase = 'HOME'; state.ndc = ''; state.drug = ''; state.pos = [];
    state.lastSignature = '';
    render();
  }

  // Minimal Settings dialog: voice on/off, rate, preview, and diagnostic.
  // (Full voice list + RS6100 pairing are a later layer — see summary.)
  function openSettings() {
    var on = voiceEnabled();
    var rate = voiceRate();
    body.innerHTML =
      '<div class="ptx7-rx-step">SETTINGS</div>' +
      '<div class="ptx7-rx-card">' +
      '<div class="name" style="font-size:22px">Location voice</div>' +
      '<button class="ptx7-rx-btn ' + (on ? 'primary' : 'ghost') + '" id="ptx7-set-voice">VOICE: ' + (on ? 'ON' : 'OFF') + '</button>' +
      '<button class="ptx7-rx-btn ghost" id="ptx7-set-rate">SPEED: ' + rate.toFixed(2) + '\u00d7</button>' +
      '<button class="ptx7-rx-btn ghost" id="ptx7-set-preview">\uD83D\uDD0A PREVIEW</button>' +
      '</div>' +
      '<div class="ptx7-rx-card"><div class="name" style="font-size:22px">Diagnostics</div>' +
      '<button class="ptx7-rx-btn ghost" id="ptx7-set-diag">SHOW DIAGNOSTIC</button>' +
      '<div id="ptx7-rx-diagbox"></div></div>' +
      '<button class="ptx7-rx-btn ghost" id="ptx7-set-back">DONE</button>';
    document.getElementById('ptx7-set-voice').onclick = function () {
      try { localStorage.setItem(VOICE_ON_KEY, voiceEnabled() ? 'false' : 'true'); } catch (e) {}
      openSettings();
    };
    document.getElementById('ptx7-set-rate').onclick = function () {
      var rates = [0.85, 1, 1.15, 1.3]; var i = rates.indexOf(voiceRate());
      var next = rates[(i + 1) % rates.length];
      try { localStorage.setItem(VOICE_RATE_KEY, String(next)); } catch (e) {}
      openSettings();
    };
    document.getElementById('ptx7-set-preview').onclick = function () { speakLocation('MANFW0103-J-04', true); };
    document.getElementById('ptx7-set-diag').onclick = function () {
      var b = document.getElementById('ptx7-rx-diagbox');
      if (b) b.innerHTML = '<textarea readonly style="width:100%;height:240px;font:12px monospace;' +
        'border:2px solid #cdd5db;border-radius:10px;padding:8px">' + esc(buildDiagnostic()) + '</textarea>';
    };
    document.getElementById('ptx7-set-back').onclick = function () { render(); };
  }

  // ---------------------------------------------------------------------------
  // Public bridge used by the Android host
  // ---------------------------------------------------------------------------
  window.__ptx7Rx = {
    open: function () {
      window.__ptx7RxReopen = false;
      root.style.display = 'block';
      // Already inside a PO receiving page -> go straight to RECEIVE; otherwise
      // show the HOME tile so the operator deliberately starts the workflow.
      if (onReceivingPage()) {
        state.phase = 'RECEIVE';
      } else {
        state.phase = 'HOME'; state.ndc = ''; state.drug = ''; state.pos = [];
      }
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
    },
    // Reopen directly in the RECEIVE phase (used after navigating into a PO).
    openInReceive: function () {
      window.__ptx7RxReopen = false;
      root.style.display = 'block';
      state.phase = 'RECEIVE';
      state.lastSignature = '';
      capture.value = '';
      try { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); } catch (e) {}
      window.scrollTo(0, 0);
      render();
      startMirror();
      setTimeout(focusCapture, 50);
      setTimeout(focusCapture, 300);
    }
  };

  // Auto-resume: after choosing a PO, PIMS navigates to the receiving page and
  // this script re-injects on the fresh document. Resume into RECEIVE once the
  // receiving page is actually ready (poll, don't guess with a fixed delay).
  try {
    var resumeRaw = sessionStorage.getItem('ptx7_rx_resume');
    if (resumeRaw) {
      var resume = JSON.parse(resumeRaw);
      if (resume && (Date.now() - Number(resume.at || 0) < 60000)) {
        var tries = 0;
        var resumeTimer = setInterval(function () {
          tries++;
          if (onReceivingPage()) {
            clearInterval(resumeTimer);
            try { sessionStorage.removeItem('ptx7_rx_resume'); } catch (e) {}
            window.__ptx7Rx.openInReceive();
          } else if (tries > 40) { // ~20s: give up waiting; keep flag cleared
            clearInterval(resumeTimer);
            try { sessionStorage.removeItem('ptx7_rx_resume'); } catch (e) {}
          }
        }, 500);
      } else {
        try { sessionStorage.removeItem('ptx7_rx_resume'); } catch (e) {}
      }
    }
  } catch (e) {}

  if (window.__ptx7RxReopen) window.__ptx7Rx.open();
})();
