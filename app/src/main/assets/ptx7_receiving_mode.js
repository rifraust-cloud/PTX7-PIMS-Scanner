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
  // Temporary controlled test. Android's visible native EditText is the sole
  // capture owner; this WebView must not capture or forward scans to PIMS.
  var NATIVE_CAPTURE_TEST = false;

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

    var itemized = cleaned.match(/^(\d{14}):[^:]+:[^:]+:[^:]+$/);
    if (itemized) return deriveNdcFromGtin(itemized[1]);

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

  // Parse the PM86 built-in imager's raw GS1 element string. This parser is
  // intentionally narrow: it converts only when GTIN (01), serial (21),
  // expiration (17), and lot (10) are all present and structurally valid.
  // RS6100 colon-form payloads and location barcodes pass through unchanged.
  function parseGs1MedicationElements(raw) {
    var source = String(raw == null ? '' : raw)
      .replace(/^\]d2/i, '')                 // optional GS1 DataMatrix AIM prefix
      .replace(/\u241d/g, '\u001d')          // visible group-separator symbol
      .replace(/[\r\n]+$/g, '');
    var elements = {};

    // Human-readable form: (01)...(21)...(17)...(10)...
    if (/\(0?1\)/.test(source)) {
      var human = source.match(/\(01\)(\d{14}).*?\(21\)([^()\u001d]+).*?\(17\)(\d{6}).*?\(10\)([^()\u001d]+)/);
      if (human) {
        elements['01'] = human[1]; elements['21'] = human[2];
        elements['17'] = human[3]; elements['10'] = human[4];
      }
    } else {
      // Some RS5100 profiles remove the GS separator and emit compact
      // 01+GTIN+21+serial+17+YYMMDD+10+lot. Enumerate every structurally valid
      // split and accept only one unique interpretation; never guess.
      if (source.indexOf('\u001d') < 0 && /^01\d{14}21/.test(source)) {
        var gtin = source.slice(2, 16);
        var remainder = source.slice(18); // after 01+GTIN14+21
        var candidates = [];
        for (var split = 1; split <= Math.min(20, remainder.length - 10); split++) {
          if (remainder.slice(split, split + 2) !== '17') continue;
          var expiration = remainder.slice(split + 2, split + 8);
          if (!/^\d{6}$/.test(expiration) || remainder.slice(split + 8, split + 10) !== '10') continue;
          var month = Number(expiration.slice(2, 4));
          var day = Number(expiration.slice(4, 6));
          if (month < 1 || month > 12 || day < 1 || day > 31) continue;
          var serial = remainder.slice(0, split);
          var lot = remainder.slice(split + 10);
          if (!serial || !lot || serial.length > 20 || lot.length > 20) continue;
          candidates.push({ gtin: gtin, serial: serial, expiration: expiration, lot: lot });
        }
        if (candidates.length !== 1) return null;
        elements['01'] = candidates[0].gtin;
        elements['21'] = candidates[0].serial;
        elements['17'] = candidates[0].expiration;
        elements['10'] = candidates[0].lot;
      } else {
        var segments = source.split('\u001d');
        for (var si = 0; si < segments.length; si++) {
        var segment = segments[si];
        while (segment.length) {
          var ai = segment.slice(0, 2);
          if (ai === '01') {
            if (!/^01\d{14}/.test(segment)) return null;
            elements['01'] = segment.slice(2, 16); segment = segment.slice(16);
          } else if (ai === '17') {
            if (!/^17\d{6}/.test(segment)) return null;
            elements['17'] = segment.slice(2, 8); segment = segment.slice(8);
          } else if (ai === '10' || ai === '21') {
            // GS1 variable-length fields terminate at the group separator or end.
            var value = segment.slice(2);
            if (!value) return null;
            elements[ai] = value; segment = '';
          } else {
            return null;
          }
        }
      }
      }
    }

    if (!/^\d{14}$/.test(elements['01'] || '') ||
        !/^\d{6}$/.test(elements['17'] || '') ||
        !/^[ -~]{1,20}$/.test(elements['10'] || '') ||
        !/^[ -~]{1,20}$/.test(elements['21'] || '')) return null;
    return { gtin: elements['01'], lot: elements['10'], expiration: elements['17'], serial: elements['21'] };
  }

  function normalizeMedicationPayloadForPims(raw) {
    var original = String(raw == null ? '' : raw).replace(/[\r\n]+$/g, '');
    if (/^\d{14}:[^:]+:\d{6}:[^:]+$/.test(original)) {
      return { payload: original, format: 'pims-colon', converted: false };
    }
    // Location and ordinary NDC/UPC scans are never transformed.
    if (/^(?:MAN(?:FW|WS)?|CLD[A-Z]*)\d{3,5}-[A-Z]-\d{1,2}$/i.test(original) || !/^\]?[dD]?2?0?1/.test(original)) {
      return { payload: original, format: 'unchanged', converted: false };
    }
    var parsed = parseGs1MedicationElements(original);
    if (!parsed) return { payload: original, format: 'unrecognized-gs1-unchanged', converted: false };
    return {
      payload: [parsed.gtin, parsed.lot, parsed.expiration, parsed.serial].join(':'),
      format: original.indexOf('\u001d') >= 0 || original.indexOf('\u241d') >= 0
        ? 'pm86-gs1-to-pims-colon'
        : 'rs5100-compact-gs1-to-pims-colon',
      converted: true
    };
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

  function tableColumnIndex(table, bodyCells, labels) {
    var headers = [].slice.call(table.querySelectorAll('thead th,[role="columnheader"]'));
    var header = headers.find(function(cell) {
      var key = normalizedLabel(cell.innerText || cell.textContent || '');
      return labels.indexOf(key) >= 0;
    });
    if (!header || !bodyCells.length) return -1;
    var hx = header.getBoundingClientRect().left + header.getBoundingClientRect().width / 2;
    var best = -1, distance = Infinity;
    bodyCells.forEach(function(cell, index) {
      var rect = cell.getBoundingClientRect(); var cx = rect.left + rect.width / 2;
      if (Math.abs(cx - hx) < distance) { distance = Math.abs(cx - hx); best = index; }
    });
    return best;
  }

  function displayNumber(value) {
    var text = String(value == null ? '' : value).replace(/,/g, '').trim();
    return /^-?\d+(?:\.\d+)?$/.test(text) ? Number(text) : null;
  }

  function packageDescription(description) {
    var match = String(description || '').match(/\((Bottle|Box|Container|Tube|Each|Carton)[^,]*,\s*(\d+(?:\.\d+)?)\s+([^)]+)\)/i);
    if (!match) return { size: 0, unit: 'units', type: 'package' };
    return { size: Number(match[2]), unit: match[3].replace(/\s+/g, ' ').trim().toLowerCase(), type: match[1].toLowerCase() };
  }

  // Observe the PIMS PO table after an item scan but before Submit Receives.
  // Uses visible header labels; never touches React internals.
  function currentQueuedReceiveDetail() {
    state.queuedItemError = '';
    var candidates = [];
    [].slice.call(document.querySelectorAll('table,[role="table"],[role="grid"]')).forEach(function(table) {
      if (table.closest && table.closest('#ptx7-rx-root')) return;
      var tableText = String(table.innerText || '');
      if (!/Currently Scanned/i.test(tableText) || !/Purchased/i.test(tableText) || !/Received/i.test(tableText)) return;
      [].slice.call(table.querySelectorAll('tbody tr,[role="row"]')).forEach(function(row) {
        var cells = [].slice.call(row.querySelectorAll(':scope > td,:scope > th,:scope > [role="cell"],:scope > [role="gridcell"]'));
        if (cells.length < 4) return;
        var currentIndex = tableColumnIndex(table, cells, ['currentlyscanned']);
        var descriptionIndex = tableColumnIndex(table, cells, ['description']);
        var purchasedIndex = tableColumnIndex(table, cells, ['purchased','qtypurchased']);
        var receivedIndex = tableColumnIndex(table, cells, ['received','qtyreceived']);
        var productIndex = tableColumnIndex(table, cells, ['productid','ndc']);
        var locationsIndex = tableColumnIndex(table, cells, ['suggestedlocations','suggestedlocation']);
        if (currentIndex < 0 || descriptionIndex < 0 || purchasedIndex < 0 || receivedIndex < 0) return;
        var rawScanned = String(cells[currentIndex].innerText || '').trim();
        var pair = parsePair(rawScanned);
        var scannedNumber = pair ? pair.pkgs : displayNumber(rawScanned);
        if (!Number.isFinite(scannedNumber) || scannedNumber <= 0) return;
        var description = String(cells[descriptionIndex].innerText || '').replace(/\s+/g,' ').trim();
        var packaging = packageDescription(description);
        var purchasedUnits = displayNumber(cells[purchasedIndex].innerText);
        var receivedUnits = displayNumber(cells[receivedIndex].innerText);
        var scanned = pair || { pkgs: scannedNumber, units: packaging.size > 0 ? scannedNumber * packaging.size : scannedNumber };
        var ordered = Number.isFinite(purchasedUnits) ? {
          units: purchasedUnits,
          pkgs: packaging.size > 0 ? Math.ceil(purchasedUnits / packaging.size) : null
        } : null;
        var received = Number.isFinite(receivedUnits) ? {
          units: receivedUnits,
          pkgs: packaging.size > 0 ? Math.floor(receivedUnits / packaging.size) : null
        } : null;
        var productId = productIndex >= 0 ? String(cells[productIndex].innerText || '').replace(/\D/g,'') : '';
        if (!productId) productId = scanToNdc11(lastScanInfo.deliveredEscaped || '') || state.ndc || '';
        var locations = locationsIndex >= 0 ? allLocationsIn(cells[locationsIndex].innerText) : [];
        candidates.push({
          stage:'QUEUED', ndc:productId, drug:description, location:locations[0] || '', locations:locations,
          ordered:ordered, received:received, scanned:scanned,
          pkgSize:packaging.size, packageType:packaging.type, unitWord:packaging.unit,
          warnings:[], key:(productId || description) + '|queued'
        });
      });
    });
    var unique = candidates.filter(function(candidate, index, array) {
      var signature = receiveTraceSignature(candidate);
      return array.findIndex(function(other){ return receiveTraceSignature(other) === signature; }) === index;
    });
    if (unique.length > 1) {
      state.queuedItemError = 'Multiple PIMS rows have Currently Scanned quantities. View PIMS before submitting.';
      return null;
    }
    return unique[0] || null;
  }

  function pimsValidationError() {
    return [].slice.call(document.querySelectorAll('[role="alert"],[data-testid*="error"],.awsui_alert_1i0s3'))
      .filter(function(element){ return !(element.closest && element.closest('#ptx7-rx-root')) && isVisible(element); })
      .map(function(element){ return String(element.innerText || element.textContent || '').replace(/\s+/g,' ').trim(); })
      .find(function(text){ return text && /error|invalid|failed|unable|cannot|not allowed|required/i.test(text); }) || '';
  }

  function pimsSubmitButton() {
    return document.querySelector('button[data-testid="submit-receives"]');
  }

  function progressReceivedNumber(progress) {
    var value = progress ? Number(progress.received) : NaN;
    return Number.isFinite(value) ? value : null;
  }

  function submitReceivesThroughPims() {
    if (state.submitProcessing) return;
    var button = pimsSubmitButton();
    var detail = currentReceiveDetail();
    if (!button || button.disabled || button.getAttribute('aria-disabled') === 'true') {
      state.submitError = 'PIMS Submit Receives is unavailable or disabled. Use View PIMS.';
      render(); return;
    }
    if (!detail || detail.stage !== 'QUEUED') {
      state.submitError = detail && detail.stage === 'LOCATION' ?
        'A location is already required. Scan a displayed location.' :
        'No single queued medication is available to submit.';
      render(); return;
    }
    state.submitProcessing = true;
    state.submitError = '';
    state.pimsValidationError = '';
    state.pendingConfirmation = {
      productKey: detail.key,
      medication: detail,
      baselinePoReceived: progressReceivedNumber(currentProgress()),
      startedAt: Date.now(),
      waitingForLocation: false
    };
    clearTimeout(state.submitTimer);
    render();
    // Stable public DOM behavior verified in DevTools. Resolve and click once;
    // never call React props/minified closures or recreate PIMS requests.
    button.click();
    state.submitTimer = setTimeout(function() {
      if (!state.submitProcessing) return;
      state.submitProcessing = false;
      state.submitError = 'PIMS did not expose a location prompt or confirmation. Review PIMS; do not press Submit repeatedly.';
      render();
    }, 8000);
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
    if (!dialog) return currentQueuedReceiveDetail();

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
      stage: 'LOCATION',
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
    lastSignature: '',
    lastPhysicalScan: '',
    lastPhysicalScanAt: 0,
    lastPhysicalScanSource: '',
    forwardSequence: 0,
    captureStartedAt: 0,
    captureEventCount: 0,
    resolvingItem: false,
    resolveTimer: null,
    lastMed: null,
    lastSpokenLoc: '',
    confirmedUntil: 0,
    confirmedTimer: null,
    uiState: '',
    settingsOpen: false,
    submitProcessing: false,
    submitTimer: null,
    submitError: '',
    pendingConfirmation: null,
    workSignature: '',
    queuedItemError: '',
    pimsValidationError: ''
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

  // Fixed receiving layout. These nodes are created once; render() updates
  // text/visibility only so scanning focus and screen geometry stay stable.
  root.style.overflow = 'hidden';
  STYLE.textContent +=
    '#ptx7-rx-bar{position:absolute;left:0;right:0;top:0;height:68px;z-index:5}' +
    '#ptx7-rx-bar .title{display:flex;flex-direction:column;align-items:center;justify-content:center;line-height:1.05}' +
    '#ptx7-rx-header-po{font-size:16px;font-weight:800;min-height:18px;opacity:.9}' +
    '#ptx7-rx-body{position:absolute;left:0;right:0;top:68px;bottom:126px;padding:14px 16px;overflow:hidden;display:block}' +
    '#ptx7-rx-fixed{height:100%;display:grid;grid-template-rows:52px minmax(138px,auto) minmax(0,1fr);gap:10px}' +
    '#ptx7-rx-status{min-height:52px;padding:8px 12px;border-radius:10px;background:#eef3f6;color:#344054;font-size:18px;font-weight:800;overflow:auto}' +
    '#ptx7-rx-status[data-kind="ok"]{background:#e6f6eb;color:#176b35}' +
    '#ptx7-rx-status[data-kind="processing"]{background:#e9f4ff;color:#075985}' +
    '#ptx7-rx-status[data-kind="error"]{background:#fff1f0;color:#b42318}' +
    '#ptx7-rx-main{border:2px solid #cdd5db;border-radius:16px;padding:12px 16px;background:#fff;overflow:hidden}' +
    '#ptx7-rx-instruction{font-size:clamp(28px,3vw,38px);font-weight:900;text-align:center;color:#172b3a;line-height:1.05;min-height:42px}' +
    '#ptx7-rx-med-name{font-size:clamp(27px,2.7vw,36px);font-weight:900;color:#172b3a;line-height:1.12;max-height:82px;overflow:auto;margin-top:5px}' +
    '#ptx7-rx-med-detail{font-size:clamp(16px,1.7vw,22px);font-weight:800;color:#59636b;min-height:24px;margin-top:4px}' +
    '#ptx7-rx-progress-primary{font-size:clamp(38px,4.5vw,58px);font-weight:900;color:#087f3f;text-align:center;line-height:1.05;margin-top:8px}' +
    '#ptx7-rx-progress-secondary{font-size:clamp(18px,2vw,25px);font-weight:800;color:#59636b;text-align:center;min-height:28px;margin-top:3px}' +
    '#ptx7-rx-progress-track{height:22px;border-radius:11px;background:#e6eaee;overflow:hidden;margin-top:8px}' +
    '#ptx7-rx-progress-fill{height:100%;width:0;background:#087f3f;border-radius:11px}' +
    '#ptx7-rx-work{border:2px solid #d7dfe5;border-radius:16px;background:#f9fbfc;overflow:hidden;display:grid;grid-template-rows:auto minmax(0,1fr)}' +
    '#ptx7-rx-work-title{font-size:clamp(24px,2.6vw,34px);font-weight:900;text-align:center;padding:10px;color:#005a61}' +
    '#ptx7-rx-work-scroll{overflow:auto;padding:4px 12px 12px;min-height:0}' +
    '.ptx7-rx-location-static{background:#087f3f;color:#fff;border-radius:14px;padding:14px;text-align:center;margin:8px 0}' +
    '.ptx7-rx-location-static .short{font-size:clamp(36px,4.3vw,58px);font-weight:900;line-height:1.05}' +
    '.ptx7-rx-location-static .full{font-size:clamp(18px,2vw,26px);font-weight:900;margin-top:4px}' +
    '#ptx7-rx-po-list{display:grid;gap:10px}' +
    '#ptx7-rx-po-list button{min-height:66px;border:3px solid #007a83;border-radius:13px;background:#fff;color:#005a61;font-size:24px;font-weight:900}' +
    '#ptx7-rx-fixed-controls{position:absolute;left:0;right:0;bottom:38px;height:88px;padding:8px 16px;background:#fff;border-top:2px solid #d7dfe5;display:grid;grid-template-columns:1fr 1.35fr;gap:10px}' +
    '#ptx7-rx-fixed-controls button{min-height:68px;border:0;border-radius:13px;background:#007a83;color:#fff;font-size:clamp(19px,2vw,26px);font-weight:900}' +
    '#ptx7-rx-fixed-controls button.secondary{background:#fff;color:#005a61;border:3px solid #007a83}' + '#ptx7-rx-submit:disabled{background:#98a2b3;color:#eef1f3;cursor:not-allowed}' +
    '#ptx7-rx-foot{position:absolute;left:0;right:0;bottom:0;height:38px;padding:7px 12px;background:#f0f3f5;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;font-size:13px}' +
    '#ptx7-rx-settings-overlay{position:absolute;inset:68px 0 0;background:#fff;z-index:9;padding:16px;overflow:auto;display:none}' +
    '#ptx7-rx-settings-overlay.open{display:block}' +
    '.ptx7-rx-setting-row{display:grid;grid-template-columns:180px 1fr;align-items:center;gap:12px;padding:12px 0;border-bottom:1px solid #d7dfe5;font-size:19px;font-weight:900}' +
    '.ptx7-rx-setting-row select{height:52px;font-size:18px;border:2px solid #98a2b3;border-radius:9px;background:#fff;padding:4px}' +
    '#ptx7-rx-settings-overlay button{min-height:58px;border:0;border-radius:11px;background:#007a83;color:#fff;font-size:20px;font-weight:900;padding:8px 14px;margin:8px 4px}' +
    '#ptx7-rx-settings-diag{display:none;width:100%;height:220px;font:12px monospace;white-space:pre;overflow:auto}' +
    '#ptx7-rx-home-static[hidden],#ptx7-rx-fixed[hidden]{display:none}' +
    '#ptx7-rx-home-static{height:100%;display:flex;align-items:center;justify-content:center}' +
    '#ptx7-rx-home-static button{width:100%;min-height:330px;border:0;border-radius:24px;background:#007a83;color:#fff;font-size:44px;font-weight:900;box-shadow:0 7px 0 #005a61}' +
    '@media(max-width:700px){#ptx7-rx-body{padding:10px;bottom:118px}#ptx7-rx-fixed{grid-template-rows:52px minmax(145px,auto) minmax(0,1fr)}#ptx7-rx-fixed-controls{height:80px;padding:6px 10px;gap:6px}#ptx7-rx-fixed-controls button{min-height:62px}.ptx7-rx-setting-row{grid-template-columns:1fr}}';

  bar.querySelector('.title').innerHTML = '<span>Receiving</span><span id="ptx7-rx-header-po"></span>';
  body.innerHTML =
    '<section id="ptx7-rx-home-static"><button type="button" id="ptx7-rx-home-start">\uD83D\uDCE6<br>RECEIVING<br><small style="font-size:20px">Tap to begin</small></button></section>' +
    '<section id="ptx7-rx-fixed" hidden>' +
      '<div id="ptx7-rx-status" data-kind="ok">Ready</div>' +
      '<section id="ptx7-rx-main">' +
        '<div id="ptx7-rx-instruction">Scan medication</div>' +
        '<div id="ptx7-rx-med-name">No medication pending</div>' +
        '<div id="ptx7-rx-med-detail"></div>' +
        '<div id="ptx7-rx-progress-primary">Ready</div>' +
        '<div id="ptx7-rx-progress-secondary">PIMS is the source of truth</div>' +
        '<div id="ptx7-rx-progress-track"><div id="ptx7-rx-progress-fill"></div></div>' +
      '</section>' +
      '<section id="ptx7-rx-work"><div id="ptx7-rx-work-title">Scan medication</div><div id="ptx7-rx-work-scroll"></div></section>' +
    '</section>';

  var controls = document.createElement('div');
  controls.id = 'ptx7-rx-fixed-controls';
  controls.innerHTML = '<button type="button" class="secondary" id="ptx7-rx-view-pims">VIEW PIMS</button>' +
    '<button type="button" id="ptx7-rx-submit">SUBMIT RECEIVES</button>';
  root.insertBefore(controls, foot);

  var settingsOverlay = document.createElement('section');
  settingsOverlay.id = 'ptx7-rx-settings-overlay';
  settingsOverlay.innerHTML = '<h2 style="font-size:30px;margin:0 0 12px">Receiving settings</h2>' +
    '<div class="ptx7-rx-setting-row"><label for="ptx7-rx-set-voice-on">Location voice</label><select id="ptx7-rx-set-voice-on"><option value="on">On</option><option value="off">Muted</option></select></div>' +
    '<div class="ptx7-rx-setting-row"><label for="ptx7-rx-set-voice-name">Voice</label><select id="ptx7-rx-set-voice-name"></select></div>' +
    '<div class="ptx7-rx-setting-row"><label for="ptx7-rx-set-voice-rate">Speech speed</label><select id="ptx7-rx-set-voice-rate"><option value="0.85">0.85\u00d7</option><option value="1">1.00\u00d7</option><option value="1.15">1.15\u00d7</option><option value="1.3">1.30\u00d7</option></select></div>' +
    '<div class="ptx7-rx-setting-row"><label for="ptx7-rx-set-voice-volume">Speech volume</label><select id="ptx7-rx-set-voice-volume"><option value="0.5">Low</option><option value="0.75">Medium</option><option value="1">High</option></select></div>' +
    '<button type="button" id="ptx7-rx-set-preview">\uD83D\uDD0A PREVIEW</button>' +
    '<button type="button" id="ptx7-rx-set-diag">SHOW DIAGNOSTIC</button>' +
    '<textarea readonly id="ptx7-rx-settings-diag"></textarea>' +
    '<button type="button" id="ptx7-rx-settings-done">DONE</button>';
  root.appendChild(settingsOverlay);

  var fixedUi = {
    home: document.getElementById('ptx7-rx-home-static'),
    fixed: document.getElementById('ptx7-rx-fixed'),
    headerPo: document.getElementById('ptx7-rx-header-po'),
    status: document.getElementById('ptx7-rx-status'),
    instruction: document.getElementById('ptx7-rx-instruction'),
    medName: document.getElementById('ptx7-rx-med-name'),
    medDetail: document.getElementById('ptx7-rx-med-detail'),
    progressPrimary: document.getElementById('ptx7-rx-progress-primary'),
    progressSecondary: document.getElementById('ptx7-rx-progress-secondary'),
    progressFill: document.getElementById('ptx7-rx-progress-fill'),
    workTitle: document.getElementById('ptx7-rx-work-title'),
    workScroll: document.getElementById('ptx7-rx-work-scroll'),
    controls: controls,
    submit: document.getElementById('ptx7-rx-submit'),
    settings: settingsOverlay
  };

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
  var VOICE_VOLUME_KEY = 'ptx7_rx_voice_volume';
  function voiceEnabled() {
    try { return localStorage.getItem(VOICE_ON_KEY) !== 'false'; } catch (e) { return true; }
  }
  function voiceRate() {
    var v = 1; try { v = Number(localStorage.getItem(VOICE_RATE_KEY) || 1); } catch (e) {}
    return [0.85, 1, 1.15, 1.3].indexOf(v) >= 0 ? v : 1;
  }
  function voiceVolume() {
    var value = 1; try { value = Number(localStorage.getItem(VOICE_VOLUME_KEY) || 1); } catch (e) {}
    return [0.5, 0.75, 1].indexOf(value) >= 0 ? value : 1;
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
      u.volume = voiceVolume();
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
      u.volume = voiceVolume();
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
  function setUiText(element, value) {
    value = String(value == null ? '' : value);
    if (element.textContent !== value) element.textContent = value;
  }

  function setUiStatus(message, kind) {
    setUiText(fixedUi.status, message);
    fixedUi.status.dataset.kind = kind || '';
  }

  function setProgress(detail, pending) {
    if (!detail) {
      setUiText(fixedUi.medName, 'No medication pending');
      setUiText(fixedUi.medDetail, state.lastMed && state.lastMed.drug ?
        'Last confirmed: ' + state.lastMed.drug : 'Scan an item to load PIMS medication details');
      setUiText(fixedUi.progressPrimary, 'Ready');
      setUiText(fixedUi.progressSecondary, 'Medication progress appears after PIMS accepts the item');
      fixedUi.progressFill.style.width = '0%';
      return;
    }
    var ord = detail.ordered, rec = detail.received, scn = detail.scanned;
    var shownReceived = rec || { pkgs: 0, units: 0 };
    var pendingPkgs = pending && scn ? scn.pkgs : 0;
    var pendingUnits = pending && scn ? scn.units : 0;
    // PIMS can include Currently Scanned inside Quantity Received before the
    // location is submitted. Subtract pending so it is never double-counted.
    var confirmedPkgs = rec ? Math.max(0, rec.pkgs - pendingPkgs) : 0;
    var confirmedUnits = rec ? Math.max(0, rec.units - pendingUnits) : 0;
    setUiText(fixedUi.medName, detail.drug || ('NDC ' + detail.ndc));
    var packageText = detail.pkgSize ? '  •  Package size ' + detail.pkgSize + ' ' + (detail.unitWord || 'units') : '';
    setUiText(fixedUi.medDetail, 'NDC ' + detail.ndc + packageText);
    if (ord) {
      setUiText(fixedUi.progressPrimary, pending ?
        confirmedPkgs + ' confirmed + ' + pendingPkgs + ' pending' :
        shownReceived.pkgs + ' of ' + ord.pkgs + ' packages');
      setUiText(fixedUi.progressSecondary, pending ?
        confirmedUnits + ' confirmed + ' + pendingUnits + ' pending of ' + ord.units + ' ' + (detail.unitWord || 'units') :
        shownReceived.units + ' of ' + ord.units + ' ' + (detail.unitWord || 'units'));
      fixedUi.progressFill.style.width = Math.max(0, Math.min(100,
        Math.round((confirmedUnits / Math.max(1, ord.units)) * 100))) + '%';
    } else if (scn) {
      setUiText(fixedUi.progressPrimary, scn.pkgs + (scn.pkgs === 1 ? ' package scanned' : ' packages scanned'));
      setUiText(fixedUi.progressSecondary, scn.units + ' ' + (detail.unitWord || 'units') +
        (pending ? ' pending; expected quantity unavailable' : ''));
      fixedUi.progressFill.style.width = '0%';
    } else {
      setUiText(fixedUi.progressPrimary, pending ? 'Item pending' : 'Received');
      setUiText(fixedUi.progressSecondary, 'PIMS quantity details unavailable');
      fixedUi.progressFill.style.width = '0%';
    }
  }

  function setWorkContent(signature, build) {
    if (state.workSignature === signature) return;
    state.workSignature = signature;
    fixedUi.workScroll.replaceChildren();
    build(fixedUi.workScroll);
  }

  function appendScanCue(container, label) {
    var cue = document.createElement('div');
    cue.className = 'ptx7-rx-scanbox';
    var glyph = document.createElement('div'); glyph.className = 'glyph'; glyph.textContent = '|||\u2009||\u2009|\u2009|||';
    var text = document.createElement('div'); text.className = 'label'; text.textContent = label;
    cue.append(glyph, text); container.appendChild(cue);
  }

  function renderPoChoices() {
    var signature = 'po|' + state.poPollTries + '|' + state.pos.map(function(p){return p.po + ':' + p.receivable;}).join('|');
    setWorkContent(signature, function(container) {
      var list = document.createElement('div'); list.id = 'ptx7-rx-po-list';
      if (!state.pos.length) {
        var message = document.createElement('div'); message.className = 'ptx7-rx-confirm bad';
        message.textContent = state.poPollTries > 20 ? 'No receivable purchase orders detected. View PIMS or scan a different NDC.' : 'Looking up purchase orders…';
        list.appendChild(message);
      } else {
        state.pos.forEach(function(p) {
          var button = document.createElement('button'); button.type = 'button';
          button.textContent = p.po + (p.receivable ? '   •   Receivable: ' + p.receivable : '');
          button.onclick = function(){ choosePo(p); };
          list.appendChild(button);
        });
      }
      var rescan = document.createElement('button'); rescan.type = 'button';
      rescan.textContent = 'SCAN A DIFFERENT NDC';
      rescan.onclick = startNdcPhase; list.appendChild(rescan); container.appendChild(list);
    });
  }

  function renderLocations(detail) {
    var locations = detail.locations || [];
    var signature = 'locations|' + detail.key + '|' + locations.join('|') + '|' + (detail.warnings || []).join('|');
    setWorkContent(signature, function(container) {
      if (!locations.length) {
        var unavailable = document.createElement('div'); unavailable.className = 'ptx7-rx-confirm bad';
        unavailable.textContent = 'Locations unavailable. View PIMS to continue safely.';
        container.appendChild(unavailable); return;
      }
      locations.forEach(function(location) {
        var card = document.createElement('div'); card.className = 'ptx7-rx-location-static';
        var short = document.createElement('div'); short.className = 'short'; short.textContent = shortLoc(location);
        var full = document.createElement('div'); full.className = 'full'; full.textContent = location;
        card.append(short, full); container.appendChild(card);
      });
      (detail.warnings || []).forEach(function(warning) {
        var box = document.createElement('div'); box.className = 'ptx7-rx-warn'; box.textContent = '⚠ ' + warning; container.appendChild(box);
      });
      appendScanCue(container, 'SCAN LOCATION');
    });
  }

  function render() {
    var isHome = state.phase === 'HOME';
    fixedUi.home.hidden = !isHome;
    fixedUi.fixed.hidden = isHome;
    fixedUi.controls.style.display = isHome ? 'none' : 'grid';
    fixedUi.submit.disabled = true;
    fixedUi.submit.textContent = 'SUBMIT RECEIVES';
    if (isHome) {
      setUiText(fixedUi.headerPo, '');
    } else if (state.phase === 'NDC') {
      setUiText(fixedUi.headerPo, 'Find purchase order');
      setUiStatus('Scanner ready. Scan a medication NDC.', 'ok');
      setUiText(fixedUi.instruction, 'Scan medication');
      setProgress(null, false);
      setUiText(fixedUi.workTitle, 'Medication barcode');
      setWorkContent('ndc-ready', function(container){ appendScanCue(container, 'SCAN NDC'); });
    } else if (state.phase === 'PO') {
      setUiText(fixedUi.headerPo, 'Select purchase order');
      setUiStatus(state.pos.length ? 'Select the correct receivable PO.' : 'Looking up purchase orders…', state.pos.length ? 'ok' : 'processing');
      setUiText(fixedUi.instruction, 'Select purchase order');
      setUiText(fixedUi.medName, state.drug || ('NDC ' + state.ndc));
      setUiText(fixedUi.medDetail, state.ndc ? 'NDC ' + state.ndc : 'Waiting for PIMS result');
      setUiText(fixedUi.progressPrimary, state.pos.length ? state.pos.length + ' PO option' + (state.pos.length === 1 ? '' : 's') : 'Loading');
      setUiText(fixedUi.progressSecondary, 'PO selection is tap-only');
      fixedUi.progressFill.style.width = '0%';
      setUiText(fixedUi.workTitle, 'Purchase orders');
      renderPoChoices();
    } else {
      var po = currentPo();
      var prog = currentProgress();
      var detail = currentReceiveDetail();
      setUiText(fixedUi.headerPo, po ? 'PO ' + po + (prog ? '   •   ' + prog.received + '/' + prog.total : '') : 'Receiving');
      fixedUi.submit.disabled = true;
      fixedUi.submit.textContent = 'SUBMIT RECEIVES';
      if (state.submitProcessing) {
        state.uiState = 'SUBMITTING';
        setUiStatus('Submitting through PIMS. Wait for its location prompt or validation result.', 'processing');
        setUiText(fixedUi.instruction, 'Submitting');
        setProgress(detail || (state.pendingConfirmation && state.pendingConfirmation.medication), true);
        setUiText(fixedUi.workTitle, 'Waiting for PIMS');
        setWorkContent('submitting', function(container){ appendScanCue(container, 'PLEASE WAIT'); });
        fixedUi.submit.textContent = 'SUBMITTING…';
      } else if (detail && detail.stage === 'QUEUED') {
        state.uiState = 'QUEUED';
        var submitButton = pimsSubmitButton();
        var canSubmit = !!submitButton && !submitButton.disabled && submitButton.getAttribute('aria-disabled') !== 'true';
        setUiStatus(state.pimsValidationError || state.queuedItemError || state.submitError ||
          (canSubmit ? 'Medication scanned. Review pending quantities, then submit through PIMS.' :
            'PIMS Submit Receives is unavailable. Use View PIMS.'),
          state.pimsValidationError || state.queuedItemError || state.submitError || !canSubmit ? 'error' : 'ok');
        setUiText(fixedUi.instruction, 'Review medication');
        setProgress(detail, true);
        setUiText(fixedUi.workTitle, 'Pending receive');
        setWorkContent('queued|' + receiveTraceSignature(detail), function(container){
          var message = document.createElement('div'); message.className = 'ptx7-rx-confirm ok';
          message.textContent = 'Press Submit Receives once. PIMS remains responsible for validation and posting.';
          container.appendChild(message);
        });
        fixedUi.submit.disabled = !canSubmit || !!state.queuedItemError;
      } else if (detail && detail.stage === 'LOCATION') {
        state.uiState = 'PENDING_LOCATION';
        setUiStatus(state.pimsValidationError || (detail.locations && detail.locations.length ?
          'Scan location to complete receive. PIMS has not confirmed receipt yet.' :
          'PIMS requires a location, but no suggested location is available. View PIMS.'),
          state.pimsValidationError || !(detail.locations && detail.locations.length) ? 'error' : 'ok');
        setUiText(fixedUi.instruction, 'Scan location');
        setProgress(detail, true);
        setUiText(fixedUi.workTitle, detail.locations && detail.locations.length > 1 ? 'Valid locations' : 'Location');
        renderLocations(detail);
        state._locs = detail.locations || [];
        if (state.pendingConfirmation) {
          state.pendingConfirmation.waitingForLocation = true;
          state.pendingConfirmation.medication = detail;
        }
        fixedUi.submit.textContent = 'SCAN LOCATION TO COMPLETE';
      } else if (state.pendingConfirmation && state.pendingConfirmation.waitingForLocation) {
        state.uiState = state.submitError ? 'ERROR' : 'WAITING_CONFIRMATION';
        setUiStatus(state.pimsValidationError || state.submitError || 'Location submitted. Waiting for PIMS to increase confirmed quantity.',
          state.pimsValidationError || state.submitError ? 'error' : 'processing');
        setUiText(fixedUi.instruction, state.submitError ? 'Check PIMS' : 'Confirming receive');
        setProgress(state.pendingConfirmation.medication, true);
        setUiText(fixedUi.workTitle, state.submitError ? 'PIMS confirmation unavailable' : 'Waiting for PIMS');
        setWorkContent('confirmation|' + (state.submitError || 'waiting'), function(container){
          var message = document.createElement('div'); message.className = state.submitError ? 'ptx7-rx-confirm bad' : 'ptx7-rx-confirm ok';
          message.textContent = state.submitError || 'Do not scan the next medication until PIMS confirms this receive.';
          container.appendChild(message);
        });
      } else if (state.resolvingItem) {
        state.uiState = 'PROCESSING';
        setUiStatus('Checking item with PIMS. Do not scan again yet.', 'processing');
        setUiText(fixedUi.instruction, 'Checking item');
        setUiText(fixedUi.medName, 'Reading current medication…');
        setUiText(fixedUi.medDetail, 'Waiting for PIMS acceptance');
        setUiText(fixedUi.progressPrimary, 'Processing');
        setUiText(fixedUi.progressSecondary, 'A captured scan is not yet a confirmed receive');
        fixedUi.progressFill.style.width = '0%';
        setUiText(fixedUi.workTitle, 'Please wait');
        setWorkContent('processing', function(container){ appendScanCue(container, 'CHECKING…'); });
      } else if (Date.now() < state.confirmedUntil) {
        state.uiState = 'CONFIRMED';
        setUiStatus('PIMS confirmed the receive.', 'ok');
        setUiText(fixedUi.instruction, 'Received');
        setProgress(state.lastMed, false);
        setUiText(fixedUi.workTitle, 'Ready for next medication');
        setWorkContent('confirmed|' + (state.lastMed ? state.lastMed.key : ''), function(container){ appendScanCue(container, 'NEXT ITEM'); });
      } else {
        state.uiState = 'READY';
        var pimsTimedOut = lastScanInfo.pimsResult === 'no-receive-dialog-change-within-2500ms';
        setUiStatus(pimsTimedOut ?
          'PIMS did not confirm the last scan. Do not rescan until you review PIMS or diagnostics.' :
          'Ready. PIMS will confirm each medication and location.', pimsTimedOut ? 'error' : 'ok');
        setUiText(fixedUi.instruction, pimsTimedOut ? 'Check PIMS' : 'Scan medication');
        setProgress(null, false);
        setUiText(fixedUi.workTitle, 'Item barcode');
        setWorkContent('receive-ready', function(container){ appendScanCue(container, 'SCAN ITEM'); });
      }
    }

    try {
      if (window.PTX7Host && window.PTX7Host.setScanOwnership) window.PTX7Host.setScanOwnership(assistantOwnsScan());
    } catch (e) {}
    if (root.style.display === 'block' && assistantOwnsScan()) setTimeout(focusCapture, 20);
    else releaseFocusToPims();
  }

  document.getElementById('ptx7-rx-home-start').onclick = startNdcPhase;
  document.getElementById('ptx7-rx-view-pims').onclick = function(){ window.__ptx7Rx.close(); };
  fixedUi.submit.onclick = submitReceivesThroughPims;

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

  function receiveTraceSignature(detail) {
    if (!detail) return '(none)';
    return [detail.ndc, (detail.locations || []).join(','),
      detail.scanned ? detail.scanned.pkgs + '/' + detail.scanned.units : '',
      detail.received ? detail.received.pkgs + '/' + detail.received.units : ''].join('|');
  }

  function markPimsReceiveConfirmed(progress) {
    var pending = state.pendingConfirmation;
    if (!pending) return;
    state.lastMed = pending.medication || state.lastMed;
    state.pendingConfirmation = null;
    state.submitProcessing = false;
    state.submitError = '';
    state.confirmedUntil = Date.now() + 1500;
    clearTimeout(state.submitTimer);
    clearTimeout(state.confirmedTimer);
    state.confirmedTimer = setTimeout(render, 1550);
    lastScanInfo.pimsResult = 'confirmed-by-pims-progress';
    lastScanInfo.pimsDetailSignature = 'PO received=' + (progress ? progress.received : '?');
    tone(true);
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
      var poReceived = progressReceivedNumber(prog);
      var validationError = pimsValidationError();
      if (validationError) {
        state.pimsValidationError = validationError;
        state.submitProcessing = false;
        clearTimeout(state.submitTimer);
      }
      if (state.submitProcessing && detail && detail.stage === 'LOCATION') {
        state.submitProcessing = false;
        clearTimeout(state.submitTimer);
        if (state.pendingConfirmation) {
          state.pendingConfirmation.waitingForLocation = true;
          state.pendingConfirmation.medication = detail;
          state.pendingConfirmation.baselinePoReceived = state.pendingConfirmation.baselinePoReceived == null ?
            poReceived : state.pendingConfirmation.baselinePoReceived;
        }
      }
      if (state.pendingConfirmation && state.pendingConfirmation.waitingForLocation &&
          (!detail || detail.stage !== 'LOCATION')) {
        var baseline = state.pendingConfirmation.baselinePoReceived;
        if (baseline != null && poReceived != null && poReceived > baseline) {
          markPimsReceiveConfirmed(prog);
        } else if (Date.now() - state.pendingConfirmation.startedAt > 8000) {
          state.submitError = 'PIMS has not exposed a confirmed quantity increase. Review PIMS; pending data was preserved.';
          state.submitProcessing = false;
        }
      }
      if (lastScanInfo.forwardedAt && lastScanInfo.pimsResult === 'awaiting-pims') {
        var responseChanged = detail && (!lastScanInfo.preForwardHadDetail ||
          receiveTraceSignature(detail) !== lastScanInfo.preForwardDetailSignature);
        var dialogClosed = !detail && lastScanInfo.preForwardHadDetail;
        if (responseChanged || dialogClosed) {
          lastScanInfo.pimsResult = dialogClosed ? 'receive-dialog-closed-or-updated' : 'receive-dialog-opened-or-updated';
          lastScanInfo.pimsResponseMs = Date.now() - lastScanInfo.forwardedAt;
          lastScanInfo.pimsDetailSignature = detail ? receiveTraceSignature(detail) : '(none)';
        }
      }
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
          if (!wasPending && nowPending) tone(true); // PIMS exposed a current item/location state
          // Dialog disappearance alone is never confirmation. The independent
          // quantity check above controls the Confirmed state.
        }
        // Announce location ONCE per change (multi vs single).
        var locKey = detail ? (detail.locations || []).join(',') : '';
        if (locKey && locKey !== state.lastSpokenLoc) {
          state.lastSpokenLoc = locKey;
          var locs = detail.locations || [];
          if (locs.length > 1) {
            speakPhrase('Multiple valid locations. ' + locs.map(spokenLocation).join('. '), false);
          }
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
    var dispatchStarted = performance.now();
    var dispatchedEvents = 0;

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
      dispatchedEvents += 1;
    }

    // Fast synchronous burst = tiny elapsed time (passes len*30ms rule).
    for (var i = 0; i < payload.length; i++) fireKeypress(payload.charAt(i));
    // Terminator: Enter (which=13).
    fireKeypress(String.fromCharCode(13));

    return {
      method: 'doc-keypress', eventTarget: 'document', payloadCharacters: payload.length,
      dispatchedEvents: dispatchedEvents, terminatorCode: 13,
      dispatchDurationMs: Math.round((performance.now() - dispatchStarted) * 1000) / 1000
    };
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
  var lastScanInfo = {
    len: 0, deliveredLen: 0, escaped: '', deliveredEscaped: '', at: 0,
    method: '', format: '', captureTrace: null, forwardTrace: null,
    forwardedAt: 0, pimsResult: 'not-forwarded', pimsResponseMs: null
  };
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
      'focusMode: ' + (state.releaseFocus ? 'RELEASED (scan goes to PIMS)' :
        (NATIVE_CAPTURE_TEST ? 'CAPTURED (native Android test field)' :
          'HYBRID (PM86 WebView input + RS Activity KeyEvents)')),
      'activeElement: ' + aeDesc,
      'currentPo: ' + (currentPo() || '(none)'),
      'progress: ' + (prog ? prog.received + '/' + prog.total : '(none)'),
      'receivePanel: ' + (detail ? ('ndc=' + detail.ndc + ' loc=' + detail.location + ' drug=' + (detail.drug || '')) : '(none)'),
      'pimsInputs: ' + probePimsInputs(),
      'lastScan: originalLen=' + lastScanInfo.len + ' deliveredLen=' + lastScanInfo.deliveredLen +
        ' format=' + lastScanInfo.format + ' method=' + lastScanInfo.method,
      'captureTrace: ' + JSON.stringify(lastScanInfo.captureTrace || {}),
      'normalization: original=' + lastScanInfo.escaped + ' delivered=' + lastScanInfo.deliveredEscaped,
      'forwardTrace: ' + JSON.stringify(lastScanInfo.forwardTrace || {}),
      'pimsResponse: result=' + lastScanInfo.pimsResult + ' latencyMs=' +
        (lastScanInfo.pimsResponseMs == null ? '(none)' : lastScanInfo.pimsResponseMs) +
        ' detail=' + (lastScanInfo.pimsDetailSignature || '(none)')
    ];
    return lines.join('\n');
  }

  function handleScan(scanned, captureTrace) {
    var original = String(scanned == null ? '' : scanned).replace(/[\r\n]+$/g, '');
    if (!original) return;
    if (NATIVE_CAPTURE_TEST) {
      setDebug('CAPTURE TEST ONLY: WebView/PIMS delivery disabled (' + original.length + 'ch)');
      return;
    }
    var now = Date.now();
    var trace = captureTrace || {};
    var source = trace.source || 'webview-capture-input';
    // Block only a duplicate arriving through another capture path. Intentional
    // later repeats from the same scanner/source remain valid.
    if (original === state.lastPhysicalScan && source !== state.lastPhysicalScanSource &&
        now - state.lastPhysicalScanAt < 750) {
      lastScanInfo.pimsResult = 'cross-path-duplicate-suppressed';
      setDebug('duplicate path ignored: ' + source + ' after ' + state.lastPhysicalScanSource);
      return;
    }
    state.lastPhysicalScan = original;
    state.lastPhysicalScanAt = now;
    state.lastPhysicalScanSource = source;

    var adapted = normalizeMedicationPayloadForPims(original);
    var delivered = adapted.payload;
    lastScanInfo = {
      len: original.length, deliveredLen: delivered.length,
      escaped: escapeCtl(original), deliveredEscaped: escapeCtl(delivered),
      at: now, method: '', format: adapted.format,
      captureTrace: Object.assign({}, trace, {
        source: source, observedLength: original.length,
        observedCharacterCodes: Array.prototype.map.call(original, function(ch){ return ch.charCodeAt(0); }).join(',')
      }),
      forwardTrace: null, forwardedAt: 0, pimsResult: 'not-forwarded', pimsResponseMs: null,
      preForwardHadDetail: false, preForwardDetailSignature: '(none)'
    };
    if (state.phase === 'NDC') {
      setDebug('NDC scan: ' + original.length + 'ch ' + adapted.format + ' via ' + source);
      onNdcScan(delivered);
    } else if (state.phase === 'RECEIVE') {
      var beforeDetail = currentReceiveDetail();
      lastScanInfo.preForwardHadDetail = !!beforeDetail;
      lastScanInfo.preForwardDetailSignature = receiveTraceSignature(beforeDetail);
      var forward = deliverScanToPims(delivered);
      state.forwardSequence += 1;
      forward.sequence = state.forwardSequence;
      forward.normalizedFormat = adapted.format;
      forward.normalizedLength = delivered.length;
      forward.normalizedCharacterCodes = Array.prototype.map.call(delivered, function(ch){ return ch.charCodeAt(0); }).join(',');
      lastScanInfo.forwardTrace = forward;
      lastScanInfo.method = forward.method + ' x' + delivered.length;
      lastScanInfo.forwardedAt = Date.now();
      lastScanInfo.pimsResult = 'awaiting-pims';
      setDebug('trace #' + forward.sequence + ': ' + source + ' ' + (trace.terminator || 'UNKNOWN') +
        ' -> ' + delivered.length + 'ch ' + adapted.format + ' -> ' + forward.method);
      state.resolvingItem = true;
      clearTimeout(state.resolveTimer);
      state.resolveTimer = setTimeout(function () {
        state.resolvingItem = false;
        if (lastScanInfo.pimsResult === 'awaiting-pims') {
          lastScanInfo.pimsResult = 'no-receive-dialog-change-within-2500ms';
          lastScanInfo.pimsResponseMs = Date.now() - lastScanInfo.forwardedAt;
        }
        render();
      }, 2500);
      state.lastSignature = '';
      setTimeout(render, 300); setTimeout(render, 900); setTimeout(render, 1600);
    } else {
      lastScanInfo.method = 'ignored (PO select is tap-only)';
      lastScanInfo.pimsResult = 'not-forwarded-po-selection';
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
    if (state.releaseFocus || state.settingsOpen) return false; // user controls/diagnostic override
    // Arm capture on HOME before the operator taps Receiving. This prevents the
    // first Bluetooth HID character from leaking during the HOME -> NDC bridge
    // transition. PO selection remains tap-only; RECEIVE is scanner-owned.
    return state.phase !== 'PO';
  }
  function releaseFocusToPims() {
    try { if (document.activeElement === capture) capture.blur(); } catch (e) {}
  }

  function focusCapture() {
    if (root.style.display !== 'block') return;
    if (!assistantOwnsScan()) { releaseFocusToPims(); return; }
    if (NATIVE_CAPTURE_TEST) {
      releaseFocusToPims();
      try {
        if (window.PTX7Host && window.PTX7Host.requestScanFocus) window.PTX7Host.requestScanFocus();
        else setDebug('CAPTURE TEST NOT READY: native bridge unavailable');
      } catch (error) { setDebug('CAPTURE TEST focus error: ' + (error.message || error)); }
      return;
    }
    // Production hybrid capture:
    // - PM86 ScanSetting/IME commits into this focused WebView input.
    // - RS5100/RS6100 hardware KeyEvents are consumed by MainActivity before
    //   reaching WebView and enter through onHostScanTrace.
    try { capture.focus({ preventScroll: true }); }
    catch (e1) { try { capture.focus(); } catch (e2) {} }
  }

  capture.addEventListener('blur', function () {
    if (root.style.display === 'block' && assistantOwnsScan()) setTimeout(focusCapture, 10);
  });
  root.addEventListener('click', function () { setTimeout(focusCapture, 0); });
  function webviewCaptureTrace(value, terminator) {
    var started = state.captureStartedAt || Date.now();
    var trace = {
      source:'webview-capture-input', focusedView:'INPUT#ptx7-rx-capture',
      capturedLength:value.length, terminator:terminator, eventCount:state.captureEventCount,
      captureDurationMs:Date.now()-started,
      characterCodes:Array.prototype.map.call(value,function(ch){return ch.charCodeAt(0);}).join(',')
    };
    state.captureStartedAt = 0; state.captureEventCount = 0;
    return trace;
  }
  capture.addEventListener('input', function () {
    if (!assistantOwnsScan()) { capture.value = ''; return; }
    if (!state.captureStartedAt) state.captureStartedAt = Date.now();
    state.captureEventCount += 1;
    setDebug('Scanning: ' + capture.value.length + 'ch via WebView input');
    clearTimeout(state.captureTimer);
    state.captureTimer = setTimeout(function () {
      var value = capture.value.replace(/[\r\n]+$/g, ''); capture.value = '';
      if (value) handleScan(value, webviewCaptureTrace(value, 'TIMEOUT_160MS'));
    }, 160);
  });
  capture.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      clearTimeout(state.captureTimer);
      var value = capture.value.replace(/[\r\n]+$/g, ''); capture.value = '';
      if (value) handleScan(value, webviewCaptureTrace(value, e.key.toUpperCase()));
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
  function populateSettingsVoices() {
    var select = document.getElementById('ptx7-rx-set-voice-name');
    var voices = availableVoices();
    var saved = ''; try { saved = localStorage.getItem(VOICE_NAME_KEY) || ''; } catch (e) {}
    select.replaceChildren();
    var automatic = document.createElement('option'); automatic.value = ''; automatic.textContent = 'Automatic device voice'; select.appendChild(automatic);
    voices.forEach(function(voice) {
      var option = document.createElement('option'); option.value = voice.voiceURI || voice.name;
      option.textContent = voice.name + ' (' + voice.lang + ')'; select.appendChild(option);
    });
    select.value = [].slice.call(select.options).some(function(option){return option.value === saved;}) ? saved : '';
  }

  function openSettings() {
    state.settingsOpen = true;
    try { if (window.PTX7Host && window.PTX7Host.setScanOwnership) window.PTX7Host.setScanOwnership(false); } catch (e) {}
    releaseFocusToPims();
    document.getElementById('ptx7-rx-set-voice-on').value = voiceEnabled() ? 'on' : 'off';
    document.getElementById('ptx7-rx-set-voice-rate').value = String(voiceRate());
    document.getElementById('ptx7-rx-set-voice-volume').value = String(voiceVolume());
    populateSettingsVoices();
    fixedUi.settings.classList.add('open');
    document.getElementById('ptx7-rx-settings-diag').style.display = 'none';
  }

  document.getElementById('ptx7-rx-set-voice-on').onchange = function(event) {
    try { localStorage.setItem(VOICE_ON_KEY, event.target.value === 'on' ? 'true' : 'false'); } catch (e) {}
    if (event.target.value === 'off' && window.speechSynthesis) window.speechSynthesis.cancel();
  };
  document.getElementById('ptx7-rx-set-voice-name').onchange = function(event) {
    try { localStorage.setItem(VOICE_NAME_KEY, event.target.value); } catch (e) {}
  };
  document.getElementById('ptx7-rx-set-voice-rate').onchange = function(event) {
    try { localStorage.setItem(VOICE_RATE_KEY, event.target.value); } catch (e) {}
  };
  document.getElementById('ptx7-rx-set-voice-volume').onchange = function(event) {
    try { localStorage.setItem(VOICE_VOLUME_KEY, event.target.value); } catch (e) {}
  };
  document.getElementById('ptx7-rx-set-preview').onclick = function() {
    speakLocation((state._locs && state._locs[0]) || 'MANFW0103-J-04', true);
  };
  document.getElementById('ptx7-rx-set-diag').onclick = function() {
    var box = document.getElementById('ptx7-rx-settings-diag');
    box.value = buildDiagnostic(); box.style.display = 'block';
  };
  document.getElementById('ptx7-rx-settings-done').onclick = function() {
    state.settingsOpen = false;
    fixedUi.settings.classList.remove('open');
    render();
    setTimeout(focusCapture, 20);
  };
  if (window.speechSynthesis && window.speechSynthesis.addEventListener) {
    window.speechSynthesis.addEventListener('voiceschanged', function() {
      if (fixedUi.settings.classList.contains('open')) populateSettingsVoices();
    });
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
      handleScan(String(scanned || ''), {source:'legacy-native-bridge',terminator:'UNKNOWN'});
    },
    onHostScanTrace: function (scanned, traceJson) {
      if (root.style.display !== 'block') return;
      var trace = {};
      try { trace = JSON.parse(String(traceJson || '{}')); }
      catch (e) { trace = {source:'native-trace-parse-error',terminator:'UNKNOWN'}; }
      handleScan(String(scanned || ''), trace);
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
