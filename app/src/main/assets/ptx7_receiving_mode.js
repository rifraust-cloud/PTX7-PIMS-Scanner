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
        return t && !/^inventory$/i.test(t) && !/pharmacy inventory management console|incoming purchases|transaction history/i.test(t);
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

  // When a drug has been scanned on the receiving page, PIMS shows a detail
  // panel that says "Scan Location to submit receives" with the drug, NDC, and
  // Suggested Locations. Returns that info, or null when no drug is pending.
  function allLocationsIn(text) {
    var found = {};
    (String(text || '').toUpperCase().match(/\b(?:MAN(?:FW|WS)?|CLD[A-Z]*)\d{3,5}-[A-Z]-\d{1,2}\b/g) || [])
      .forEach(function(location){ found[location] = true; });
    return Object.keys(found).sort(function(a,b){ return a.localeCompare(b,undefined,{numeric:true}); });
  }

  function parseQuantityPair(value) {
    var match = String(value || '').match(/(\d+)\s*\((\d+)\)/);
    return match ? { pkgs:Number(match[1]), units:Number(match[2]) } : null;
  }

  function readTableByHeaders(table) {
    if (!table) return [];
    var headers = [].slice.call(table.querySelectorAll('thead th'));
    if (!headers.length) headers = [].slice.call(table.querySelectorAll('tr:first-child th,tr:first-child td'));
    var keys = headers.map(function(header){ return String(header.innerText || '').replace(/\s+/g,' ').trim().toLowerCase(); });
    return [].slice.call(table.querySelectorAll('tbody tr')).map(function(row){
      var result = {}, cells = [].slice.call(row.querySelectorAll(':scope > td,:scope > th'));
      cells.forEach(function(cell,index){ result[keys[index] || ('col'+index)] = cell; });
      return result;
    });
  }

  function panelQuantity(scopeText,label) {
    var match = String(scopeText || '').match(new RegExp(label + '\\s*:?\\s*(\\d+)\\s*\\((\\d+)\\)','i'));
    return match ? { pkgs:Number(match[1]), units:Number(match[2]) } : null;
  }

  // Read only the active PIMS receive dialog, then match its Product Id to the
  // side panel before using quantities/package details. Never use stale page text.
  function currentReceiveDetail() {
    var marker = /Complete receive before proceeding to next NDC|Scan Location to submit receives/i;
    var dialog = [].slice.call(document.querySelectorAll('[role="dialog"],[role="alertdialog"]'))
      .filter(function(element){ return !(element.closest && element.closest('#ptx7-rx-root')); })
      .find(function(element){ return marker.test(element.textContent || ''); });
    if (!dialog) return null;

    var rowObjects = [];
    [].slice.call(dialog.querySelectorAll('table')).forEach(function(table){ rowObjects = rowObjects.concat(readTableByHeaders(table)); });
    var pending = rowObjects.find(function(row){
      var cell = row['product id'] || row.productid || row.product;
      return cell && /\d{6,}/.test(cell.innerText || '');
    });
    if (!pending) return null;

    var productCell = pending['product id'] || pending.productid || pending.product;
    var productId = String(productCell.innerText || '').replace(/\D/g,'');
    var descriptionCell = pending.description || pending.desc;
    var drug = descriptionCell ? String(descriptionCell.innerText || '').replace(/\s+/g,' ').trim() : '';
    var scannedCell = pending['currently scanned'] || pending.scanned;
    var scanned = scannedCell ? parseQuantityPair(scannedCell.innerText) : null;
    var locationsCell = pending['suggested locations'] || pending['suggested location'] || pending.locations;
    var locations = locationsCell ? allLocationsIn(locationsCell.innerText) : [];
    if (!locations.length) locations = allLocationsIn(dialog.innerText);

    var ordered = null, received = null, packageSize = 0, unitWord = 'units', warnings = [];
    var sidePanels = [].slice.call(document.querySelectorAll('aside,section,div'))
      .filter(function(element){
        if (element.closest && element.closest('#ptx7-rx-root')) return false;
        var text = element.innerText || '';
        return productId && text.indexOf(productId) >= 0 && /Quantity (Ordered|Received)/i.test(text);
      })
      .sort(function(a,b){ return (a.innerText || '').length - (b.innerText || '').length; });
    if (sidePanels.length) {
      var sideText = String(sidePanels[0].innerText || '').replace(/\u00a0/g,' ');
      ordered = panelQuantity(sideText,'Quantity Ordered');
      received = panelQuantity(sideText,'Quantity Received');
      var packageMatch = sideText.match(/Package Size\s*:?\s*(\d+(?:\.\d+)?)/i);
      if (packageMatch) packageSize = Number(packageMatch[1]);
      var unitMatch = sideText.match(/\d+\.?\d*\s*(Capsules?|Tablets?|Milliliters?|mL|Grams?|Each|Units?|Inhalers?|Sprays?)/i);
      if (unitMatch) unitWord = unitMatch[1].toLowerCase();
      if (/hazardous drug|special handling|N\s*Listed Hazard/i.test(sideText)) warnings.push('HAZARDOUS — Special Handling');
      if (/cold chain|refrigerat/i.test(sideText)) warnings.push('COLD CHAIN');
      if (!drug) {
        var descriptionMatch = sideText.match(/([A-Z0-9][^\n]*?\((?:bottle|box|container|tube|each|carton)[^\n]*?\))/i);
        if (descriptionMatch) drug = descriptionMatch[1].replace(/\s+/g,' ').trim();
      }
    }
    if (!packageSize && scanned && scanned.pkgs > 0) packageSize = scanned.units / scanned.pkgs;
    return {
      ndc:productId, drug:drug, location:locations[0] || '', locations:locations,
      ordered:ordered, received:received, scanned:scanned, pkgSize:packageSize,
      unitWord:unitWord, warnings:warnings, key:productId
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
    phase: 'NDC',       // 'NDC' (scan to look up) | 'PO' (select) | 'RECEIVE'
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
    '.ptx7-rx-po{background:#fff;color:#007A83;border:6px solid #007A83;box-shadow:0 5px 14px #0002}' +
    '.ptx7-rx-confirm{border-radius:18px;padding:22px 16px;margin:18px 0;text-align:center;font-weight:900;font-size:26px}' +
    '.ptx7-rx-confirm.ok{background:#e6f6eb;border:3px solid #087f3f;color:#087f3f}' +
    '.ptx7-rx-confirm.bad{background:#fff1f0;border:3px solid #b42318;color:#b42318}' +
    '.ptx7-rx-confirm .meta{display:block;color:#172b3a;font-weight:700;font-size:18px;margin-top:8px}' +
    '.ptx7-rx-success{background:#087f3f;color:#fff;border-radius:22px;padding:34px 16px;text-align:center;margin:20px 0}' +
    '.ptx7-rx-success .big{font-size:44px;font-weight:900}' +
    '.ptx7-rx-success .loc{font-size:40px;font-weight:900;margin-top:14px;letter-spacing:1px}' +
    '.ptx7-rx-success .drug{font-size:22px;margin-top:12px}' +
    '#ptx7-rx-foot{position:sticky;bottom:0;background:#f6f8f9;text-align:center;color:#59636b;font-size:15px;padding:12px 14px}';
  // Visual-only handheld sizing overrides. Existing render/state/scanner
  // functions remain unchanged from confirmed working build #49.
  STYLE.textContent +=
    '#ptx7-rx-root{inset:0 auto auto 0!important;width:50%!important;height:50%!important;transform:scale(2);transform-origin:top left;overflow-y:auto;overflow-x:hidden;background:#fff}' +
    '#ptx7-rx-bar{min-height:112px;padding:16px 22px;position:sticky;top:0;z-index:4;border-bottom:6px solid #005a61}' +
    '#ptx7-rx-bar .title{font-size:54px}' +
    '#ptx7-rx-bar .back,#ptx7-rx-bar .gear{width:96px;height:84px;font-size:38px;padding:8px}' +
    '#ptx7-rx-body{padding:32px 28px 190px;max-width:100%;min-height:calc(100vh - 150px)}' +
    '.ptx7-rx-step{font-size:38px;margin:18px 0 12px}' +
    '.ptx7-rx-head{font-size:64px;line-height:1.12;margin:22px 0}' +
    '.ptx7-rx-sub{font-size:36px;line-height:1.4;margin:16px 0 26px}' +
    '.ptx7-rx-scanbox{min-height:330px;display:flex;flex-direction:column;justify-content:center;padding:46px 26px;border-width:9px}' +
    '.ptx7-rx-scanbox .glyph{font-size:112px}.ptx7-rx-scanbox .label{font-size:60px}' +
    '.ptx7-rx-btn{min-height:132px;font-size:48px;margin:24px 0;border-radius:24px}' +
    '.ptx7-rx-btn .meta{font-size:34px;margin-top:14px}' +
    '.ptx7-rx-success{padding:42px 28px;border-radius:26px}' +
    '.ptx7-rx-success .big{font-size:64px}.ptx7-rx-success .loc{font-size:94px;line-height:1.08}' +
    '.ptx7-rx-success .drug{font-size:42px;line-height:1.25}' +
    '.ptx7-rx-confirm{font-size:46px;padding:38px 26px}.ptx7-rx-confirm .meta{font-size:34px}' +
    '#ptx7-rx-submit-fixed{position:fixed;right:24px;bottom:108px;z-index:8;min-width:42%;min-height:112px;border:0;border-radius:18px;background:#007a83;color:#fff;font:900 38px Arial;box-shadow:0 6px 18px #0005;padding:16px 22px}' +
    '#ptx7-rx-new-po{position:fixed;left:24px;bottom:108px;z-index:8;display:none;min-width:42%;min-height:112px;border:5px solid #007a83;border-radius:18px;background:#fff;color:#007a83;font:900 36px Arial;box-shadow:0 6px 18px #0003;padding:16px 22px}' +
    '#ptx7-rx-submit-fixed:disabled{background:#98a2b3;color:#e9edf1;box-shadow:none}' +
    '#ptx7-rx-foot{font-size:26px;min-height:58px;padding:16px}' +
    '@media(max-width:900px){#ptx7-rx-bar .title{font-size:46px}.ptx7-rx-head{font-size:56px}.ptx7-rx-success .loc{font-size:80px}.ptx7-rx-btn{font-size:42px}}';
  root.appendChild(STYLE);

  var bar = document.createElement('div');
  bar.id = 'ptx7-rx-bar';
  bar.innerHTML = '<button class="back" type="button" id="ptx7-rx-back">\u2039 PIMS</button>' +
    '<div class="title">RECEIVING</div>' +
    '<button class="back gear" type="button" id="ptx7-rx-gear" aria-label="Tools and settings">\u2699</button>';
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

  var submitReceivesButton = document.createElement('button');
  submitReceivesButton.id = 'ptx7-rx-submit-fixed';
  submitReceivesButton.type = 'button';
  submitReceivesButton.textContent = 'SUBMIT RECEIVES';
  submitReceivesButton.style.display = 'none';
  root.appendChild(submitReceivesButton);

  var newPoButton = document.createElement('button');
  newPoButton.id = 'ptx7-rx-new-po';
  newPoButton.type = 'button';
  newPoButton.textContent = 'SEARCH NEW PO';
  root.appendChild(newPoButton);
  newPoButton.addEventListener('click', function () {
    var unfinished = !!currentReceiveDetail() || !!queuedReceiveSignature() || submitReceivesBusy;
    if (unfinished && !confirm('Current item is unfinished—leave anyway?\n\nUnsaved receiving data will be lost.')) return;
    try { sessionStorage.removeItem('ptx7_rx_resume'); } catch (_) {}
    try {
      if (window.PTX7Host && window.PTX7Host.startNewPoSearch) {
        window.PTX7Host.startNewPoSearch();
        return;
      }
    } catch (_) {}
    root.style.display = 'none';
    location.href = INVENTORY_URL;
  });

  var submitReceivesBusy = false;
  var lastAutoSubmittedQueue = '';
  function queuedReceiveSignature() {
    var tables = [].slice.call(document.querySelectorAll('table'));
    for (var ti=0; ti<tables.length; ti++) {
      var table=tables[ti];
      if (table.closest && table.closest('#ptx7-rx-root')) continue;
      if (!/Currently Scanned/i.test(table.innerText || '')) continue;
      var headers=[].slice.call(table.querySelectorAll('thead th')).map(function(h){return String(h.innerText||'').replace(/[^a-z0-9]/gi,'').toLowerCase();});
      var index=headers.findIndex(function(h){return h==='currentlyscanned';});
      if(index<0) continue;
      var rows=[].slice.call(table.querySelectorAll('tbody tr'));
      for(var ri=0;ri<rows.length;ri++){
        var cells=[].slice.call(rows[ri].querySelectorAll(':scope > td,:scope > th'));
        var value=String((cells[index]&&cells[index].innerText)||'').trim();
        var quantity=Number(((value.match(/[\d.]+/)||['0'])[0]));
        if(quantity>0) return String(rows[ri].innerText||'').replace(/\s+/g,' ').trim();
      }
    }
    return '';
  }
  function clickSubmitReceivesOnce(reason) {
    if (submitReceivesBusy) return false;
    var pimsButton = document.querySelector('button[data-testid="submit-receives"]');
    if (!pimsButton || pimsButton.disabled || pimsButton.getAttribute('aria-disabled') === 'true') {
      setDebug('PIMS Submit Receives is unavailable — return to PIMS');
      return false;
    }
    submitReceivesBusy = true;
    submitReceivesButton.disabled = true;
    submitReceivesButton.textContent = 'SUBMITTING…';
    setDebug('Submit Receives activated once (' + reason + '); waiting for PIMS');
    pimsButton.click();
    // A click is never confirmation. PIMS dialog/quantities remain authoritative.
    setTimeout(function(){ submitReceivesBusy = false; }, 1800);
    return true;
  }
  submitReceivesButton.addEventListener('click', function() { clickSubmitReceivesOnce('manual fallback'); });
  setInterval(function() {
    var receiving = root.style.display === 'block' && state.phase === 'RECEIVE';
    newPoButton.style.display = receiving && onReceivingPage() ? 'block' : 'none';
    var detail = receiving ? currentReceiveDetail() : null;
    var pimsButton = receiving ? document.querySelector('button[data-testid="submit-receives"]') : null;
    submitReceivesButton.style.display = receiving ? 'block' : 'none';
    if (!receiving) { lastAutoSubmittedQueue=''; return; }
    if (detail) {
      submitReceivesBusy = false;
      submitReceivesButton.disabled = true;
      submitReceivesButton.textContent = 'SCAN LOCATION TO COMPLETE';
      return;
    }
    var queue = queuedReceiveSignature();
    if (!queue) lastAutoSubmittedQueue = '';
    var available = !!pimsButton && !pimsButton.disabled && pimsButton.getAttribute('aria-disabled') !== 'true';
    if (queue && queue !== lastAutoSubmittedQueue && available && !submitReceivesBusy) {
      lastAutoSubmittedQueue = queue;
      clickSubmitReceivesOnce('PIMS Currently Scanned row');
      return;
    }
    submitReceivesButton.disabled = submitReceivesBusy || !available;
    submitReceivesButton.textContent = submitReceivesBusy ? 'SUBMITTING…' : 'SUBMIT RECEIVES';
  }, 350);

  // ---------------------------------------------------------------------------
  // Audio feedback (Web Audio, no assets)
  // ---------------------------------------------------------------------------
  var audioCtx = null;
  var SOUND_STYLE_KEY = 'ptx7_rx_sound_style';
  var SOUND_VOLUME_KEY = 'ptx7_rx_sound_volume';
  function soundStyle(){ try{return localStorage.getItem(SOUND_STYLE_KEY)||'gentle';}catch(e){return 'gentle';} }
  function soundVolume(){ var value='low';try{value=localStorage.getItem(SOUND_VOLUME_KEY)||'low';}catch(e){}return {low:0.025,medium:0.05,high:0.09}[value]||0.025; }
  function tone(ok) {
    try {
      var style=soundStyle();if(style==='muted')return;
      var Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      audioCtx = audioCtx || new Ctx();
      if (audioCtx.state === 'suspended') audioCtx.resume();
      var gentle=style==='gentle';
      var seq=gentle?(ok?[[560,0,0.11],[720,0.13,0.20]]:[[240,0,0.16],[190,0.18,0.26]]):(ok?[[980,0,0.08],[1280,0.10,0.16]]:[[300,0,0.18],[190,0.20,0.28]]);
      var peak=soundVolume(),t0=audioCtx.currentTime+0.02;
      seq.forEach(function(n){
        var osc=audioCtx.createOscillator(),g=audioCtx.createGain();
        osc.type=gentle?'sine':(ok?'square':'sawtooth');
        osc.frequency.setValueAtTime(n[0],t0+n[1]);
        g.gain.setValueAtTime(0.0001,t0+n[1]);
        g.gain.exponentialRampToValueAtTime(peak,t0+n[1]+0.025);
        g.gain.exponentialRampToValueAtTime(0.0001,t0+n[1]+n[2]);
        osc.connect(g);g.connect(audioCtx.destination);osc.start(t0+n[1]);osc.stop(t0+n[1]+n[2]+0.03);
      });
    } catch (e) {}
  }


  // Voice and settings are visual/accessibility helpers only. They do not
  // participate in scanner capture or PIMS delivery.
  var VOICE_ON_KEY = 'ptx7_rx_voice_on';
  var VOICE_NAME_KEY = 'ptx7_rx_voice_name';
  var VOICE_RATE_KEY = 'ptx7_rx_voice_rate';
  var ORIENTATION_KEY = 'ptx7_rx_orientation';
  function voiceEnabled(){ try{return localStorage.getItem(VOICE_ON_KEY)!=='false';}catch(e){return true;} }
  function voiceRate(){ var value=1;try{value=Number(localStorage.getItem(VOICE_RATE_KEY)||1);}catch(e){}return [0.85,1,1.15,1.3].indexOf(value)>=0?value:1; }
  function voices(){ return window.speechSynthesis ? window.speechSynthesis.getVoices().filter(function(v){return /^en[-_]/i.test(v.lang||'');}) : []; }
  function selectedVoice(){ var all=voices(),saved='';try{saved=localStorage.getItem(VOICE_NAME_KEY)||'';}catch(e){}return all.find(function(v){return v.voiceURI===saved||v.name===saved;})||all[0]||null; }
  function spokenLocation(location){
    var value=String(location||'').toUpperCase();
    var match=value.match(/^(?:MAN(?:FW|WS)?|CLD[A-Z]*)0*(\d{3})-([A-Z])-(\d{1,2})$/);
    if(!match)return value.replace(/-/g,', ');
    return match[1].split('').join(' ')+', '+match[2]+', '+Number(match[3]);
  }
  function speakLocations(locations,force){
    try{
      if(!window.speechSynthesis||(!force&&!voiceEnabled()))return;
      var list=(locations||[]).filter(Boolean);if(!list.length)return;
      window.speechSynthesis.cancel();
      var text=list.length===1?spokenLocation(list[0]):'Multiple valid locations. '+list.map(spokenLocation).join('. ');
      var utterance=new SpeechSynthesisUtterance(text);utterance.rate=voiceRate();var voice=selectedVoice();if(voice)utterance.voice=voice;
      window.speechSynthesis.speak(utterance);
    }catch(e){}
  }
  var lastSpokenLocations='';
  setInterval(function(){
    if(root.style.display!=='block'||state.phase!=='RECEIVE')return;
    var detail=currentReceiveDetail();var key=detail&&detail.locations?detail.ndc+'|'+detail.locations.join('|'):'';
    if(key&&key!==lastSpokenLocations){lastSpokenLocations=key;speakLocations(detail.locations,false);}
    if(!detail)lastSpokenLocations='';
  },500);

  var settings=document.createElement('section');
  settings.id='ptx7-rx-settings';
  settings.style.cssText='position:fixed;inset:112px 0 84px;z-index:20;display:none;background:#fff;padding:34px;overflow:auto;font:900 34px Arial;color:#172b3a';
  settings.innerHTML='<h2 style="font-size:56px;margin:0 0 26px;border-bottom:5px solid #007a83;padding-bottom:14px">TOOLS / SETTINGS</h2>'+
    '<label style="display:block;margin:22px 0">SCAN TONES <select id="ptx7-sound-style" style="width:100%;height:88px;font-size:32px"><option value="gentle">GENTLE CHIME (DEFAULT)</option><option value="standard">STANDARD BEEP</option><option value="muted">MUTED</option></select></label>'+
    '<label style="display:block;margin:22px 0">TONE VOLUME <select id="ptx7-sound-volume" style="width:100%;height:88px;font-size:32px"><option value="low">LOW (DEFAULT)</option><option value="medium">MEDIUM</option><option value="high">HIGH</option></select></label>'+
    '<button id="ptx7-tone-preview" class="ptx7-rx-btn ghost">♪ PREVIEW TONE</button>'+
    '<label style="display:block;margin:22px 0">LOCATION VOICE <select id="ptx7-voice-on" style="width:100%;height:88px;font-size:32px"><option value="on">ON</option><option value="off">MUTED</option></select></label>'+
    '<label style="display:block;margin:22px 0">VOICE <select id="ptx7-voice-name" style="width:100%;height:88px;font-size:32px"></select></label>'+
    '<label style="display:block;margin:22px 0">SPEED <select id="ptx7-voice-rate" style="width:100%;height:88px;font-size:32px"><option value="0.85">0.85×</option><option value="1">1.00×</option><option value="1.15">1.15×</option><option value="1.3">1.30×</option></select></label>'+
    '<label style="display:block;margin:22px 0">ORIENTATION <select id="ptx7-orientation" style="width:100%;height:88px;font-size:32px"><option value="AUTO">AUTO ROTATE</option><option value="PORTRAIT">LOCK PORTRAIT</option><option value="LANDSCAPE">LOCK LANDSCAPE</option></select></label>'+
    '<button id="ptx7-voice-preview" class="ptx7-rx-btn primary">🔊 PREVIEW LOCATION</button>'+
    '<button id="ptx7-show-diag" class="ptx7-rx-btn ghost">SHOW DIAGNOSTIC</button>'+
    '<textarea id="ptx7-settings-diag" readonly style="display:none;width:100%;height:320px;font:22px monospace"></textarea>'+
    '<button id="ptx7-settings-done" class="ptx7-rx-btn primary">DONE</button>';
  root.appendChild(settings);
  function populateVoiceSettings(){
    var select=settings.querySelector('#ptx7-voice-name'),saved='';try{saved=localStorage.getItem(VOICE_NAME_KEY)||'';}catch(e){}
    select.replaceChildren(new Option('Automatic device voice',''));
    voices().forEach(function(v){select.add(new Option(v.name+' ('+v.lang+')',v.voiceURI||v.name));});select.value=saved;
  }
  function openSettings(){
    state.releaseFocus=true;
    try{capture.blur();}catch(e){}
    try{if(window.PTX7Host&&window.PTX7Host.setScanOwnership)window.PTX7Host.setScanOwnership(false);}catch(e){}
    settings.querySelector('#ptx7-sound-style').value=soundStyle();
    var savedVolume='low';try{savedVolume=localStorage.getItem(SOUND_VOLUME_KEY)||'low';}catch(_){}
    settings.querySelector('#ptx7-sound-volume').value=savedVolume;
    settings.querySelector('#ptx7-voice-on').value=voiceEnabled()?'on':'off';
    settings.querySelector('#ptx7-voice-rate').value=String(voiceRate());
    settings.querySelector('#ptx7-orientation').value=localStorage.getItem(ORIENTATION_KEY)||'AUTO';
    populateVoiceSettings();settings.style.display='block';
  }
  settings.querySelector('#ptx7-sound-style').onchange=function(e){localStorage.setItem(SOUND_STYLE_KEY,e.target.value);};
  settings.querySelector('#ptx7-sound-volume').onchange=function(e){localStorage.setItem(SOUND_VOLUME_KEY,e.target.value);};
  settings.querySelector('#ptx7-tone-preview').onclick=function(){tone(true);};
  settings.querySelector('#ptx7-voice-on').onchange=function(e){localStorage.setItem(VOICE_ON_KEY,e.target.value==='on'?'true':'false');if(e.target.value==='off'&&window.speechSynthesis)window.speechSynthesis.cancel();};
  settings.querySelector('#ptx7-voice-name').onchange=function(e){localStorage.setItem(VOICE_NAME_KEY,e.target.value);};
  settings.querySelector('#ptx7-voice-rate').onchange=function(e){localStorage.setItem(VOICE_RATE_KEY,e.target.value);};
  settings.querySelector('#ptx7-orientation').onchange=function(e){localStorage.setItem(ORIENTATION_KEY,e.target.value);try{if(window.PTX7Host&&window.PTX7Host.setOrientationMode)window.PTX7Host.setOrientationMode(e.target.value);}catch(_){};};
  settings.querySelector('#ptx7-voice-preview').onclick=function(){var d=currentReceiveDetail();speakLocations(d&&d.locations&&d.locations.length?d.locations:['MANFW0105-C-10'],true);};
  settings.querySelector('#ptx7-show-diag').onclick=function(){var box=settings.querySelector('#ptx7-settings-diag');box.value=buildDiagnostic();box.style.display='block';};
  settings.querySelector('#ptx7-settings-done').onclick=function(){settings.style.display='none';state.releaseFocus=false;render();setTimeout(focusCapture,20);};
  document.getElementById('ptx7-rx-gear').onclick=openSettings;
  if(window.speechSynthesis&&window.speechSynthesis.addEventListener)window.speechSynthesis.addEventListener('voiceschanged',function(){if(settings.style.display==='block')populateVoiceSettings();});

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
      h += '<div class="ptx7-rx-step">' + (po ? 'PO ' + esc(po) : 'RECEIVING') + '</div>';

      if (detail) {
        // Active PIMS dialog is authoritative. Bind identity, quantities, and
        // all locations from the same current product snapshot.
        var ordered = detail.ordered, received = detail.received, scanned = detail.scanned;
        var pendingPkgs = scanned ? scanned.pkgs : 0;
        var pendingUnits = scanned ? scanned.units : 0;
        var confirmedPkgs = received ? Math.max(0, received.pkgs - pendingPkgs) : 0;
        var confirmedUnits = received ? Math.max(0, received.units - pendingUnits) : 0;
        h += '<div class="ptx7-rx-head">Scan location to complete receive</div>';
        h += '<div class="ptx7-rx-confirm ok"><strong>' + esc(detail.drug || ('NDC ' + detail.ndc)) + '</strong>' +
          '<span class="meta">NDC ' + esc(detail.ndc) + (detail.pkgSize ? ' · Package size ' + esc(detail.pkgSize) + ' ' + esc(detail.unitWord) : '') + '</span>';
        if (scanned && ordered) {
          h += '<div style="font-size:38px;margin-top:12px">' + esc(scanned.pkgs) + ' of ' + esc(ordered.pkgs) + ' bottles scanned</div>' +
            '<span class="meta" style="font-size:26px">' + esc(scanned.units) + ' of ' + esc(ordered.units) + ' ' + esc(detail.unitWord) + '</span>' +
            '<span class="meta">' + esc(confirmedPkgs) + ' confirmed · ' + esc(pendingPkgs) + ' pending (' + esc(confirmedUnits) + ' confirmed · ' + esc(pendingUnits) + ' pending)</span>';
        } else if (scanned) {
          h += '<div style="font-size:38px;margin-top:12px">' + esc(scanned.pkgs) + ' bottle' + (scanned.pkgs === 1 ? '' : 's') + ' scanned</div>' +
            '<span class="meta">Expected quantity unavailable</span>';
        } else {
          h += '<span class="meta">Pending quantity loading from PIMS</span>';
        }
        h += '</div>';
        if (detail.warnings && detail.warnings.length) h += '<div class="ptx7-rx-confirm bad">⚠ ' + esc(detail.warnings.join(' · ')) + '</div>';
        if (detail.locations && detail.locations.length) {
          h += '<div class="ptx7-rx-sub" style="font-weight:900">Suggested locations</div>';
          detail.locations.forEach(function(location){
            h += '<div class="ptx7-rx-success" style="margin:12px 0"><div class="loc">' + esc(location) + '</div></div>';
          });
        } else {
          h += '<div class="ptx7-rx-confirm bad">Suggested locations unavailable — View PIMS</div>';
        }
        h += scanBox('SCAN LOCATION');
        h += '<div class="ptx7-rx-sub">Pending location confirmation. Receipt is not confirmed yet.</div>';
      } else {
        // Ready for the next item. Show a big "begin / progress" prompt.
        h += '<div class="ptx7-rx-head">Begin receiving inventory</div>';
        if (prog) {
          h += '<div class="ptx7-rx-confirm ok" style="font-size:40px">' +
            esc(prog.received) + ' / ' + esc(prog.total) +
            '<span class="meta">items received in this PO</span></div>';
        }
        h += scanBox('SCAN ITEM');
        h += '<div class="ptx7-rx-sub">Scan each item\u2019s 2D barcode, then its location.</div>';
        h += '<div class="ptx7-rx-sub" style="font-size:12px;color:#8a93a0">inputs: ' + esc(probePimsInputs()) + '</div>';
        h += '<button class="ptx7-rx-btn wait" type="button" id="ptx7-rx-togglefocus" style="font-size:18px">' +
          (state.releaseFocus ? 'FOCUS: RELEASED (scan \u2192 PIMS)' : 'FOCUS: CAPTURED (overlay)') + '</button>';
        h += '<button class="ptx7-rx-btn wait" type="button" id="ptx7-rx-diag" style="font-size:18px">SHOW DIAGNOSTIC</button>';
        h += '<div id="ptx7-rx-diagbox"></div>';
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

    // Tell the native host whether we own the scan right now (NDC) or PIMS does
    // (PO/RECEIVE), so native key interception matches and PIMS gets the scan.
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
      // Include progress + pending detail so the count never goes stale.
      var sig = currentPo() + '|' +
        (prog ? prog.received + '/' + prog.total : '?') + '|' +
        (detail ? (detail.ndc + '@' + detail.location) : 'idle');
      if (sig !== state.lastSignature) {
        var prev = state.lastSignature;
        state.lastSignature = sig;
        // Confirmation feedback only on real PIMS transitions:
        if (prev) {
          var wasPending = /@/.test(prev.split('|')[2] || '');
          var nowPending = !!detail;
          if (!wasPending && nowPending) tone(true);       // item accepted -> location
          else if (wasPending && !nowPending) tone(true);  // location submitted -> confirmed
        }
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
      // Reflect PIMS's resulting state (item accepted -> location, or submitted).
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

  document.getElementById('ptx7-rx-back').onclick = function () { window.__ptx7Rx.close(); };

  // ---------------------------------------------------------------------------
  // Public bridge used by the Android host
  // ---------------------------------------------------------------------------
  window.__ptx7Rx = {
    open: function () {
      window.__ptx7RxReopen = false;
      root.style.display = 'block';
      // If PIMS is already on a PO receiving page, open straight into RECEIVE
      // so a tap on RECEIVE while inside a PO doesn't force a new NDC lookup.
      if (onReceivingPage()) {
        state.phase = 'RECEIVE';
      } else {
        state.phase = 'NDC'; state.ndc = ''; state.drug = ''; state.pos = [];
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
    isReceivingPage: function () { return onReceivingPage(); },
    normalizeNdc: function (raw) { return scanToNdc11(raw); },
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
