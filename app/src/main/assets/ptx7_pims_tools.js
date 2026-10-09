(function () {
  'use strict';
  if (window.__ptx7PimsToolsInstalled) return;
  window.__ptx7PimsToolsInstalled = true;

  var INVENTORY_URL = 'https://console.inventory.pharmacy.amazon.dev/inventory?facility=PTX7';
  var inventorySimple = true;
  var locationsSimple = true;
  var lastSubmitted = '';
  var lastSubmittedAt = 0;
  var locationAutoTimer = null;
  var inventoryScanTimer = null;
  var inventoryFirstAt = 0;
  var inventoryEventCount = 0;
  var renderTimer = null;
  var lastRenderSignature = '';
  var poActions = [];
  var inventorySearchBusy = false;
  var transactionWakeRequested = false;
  var nativeActionActive = false;

  function normalize(value) { return String(value == null ? '' : value).replace(/\s+/g, ' ').trim(); }
  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
      return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
    });
  }
  function visible(element) {
    if (!element) return false;
    var css = getComputedStyle(element), rect = element.getBoundingClientRect();
    return css.display !== 'none' && css.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
  }
  function isToolElement(element) {
    return !!(element && element.closest && element.closest('#ptx7-inventory-root,#ptx7-full-view-toggle,#ptx7-route-message,#ptx7-receive-current-po,#ptx7-rx-root'));
  }
  function nativeElements(selector) {
    return [].slice.call(document.querySelectorAll(selector)).filter(function (element) { return !isToolElement(element); });
  }
  function nativeBodyText() {
    return [].slice.call(document.body ? document.body.children : []).filter(function (element) {
      return !/^ptx7-/.test(element.id || '');
    }).map(function (element) { return normalize(element.innerText); }).join('\n');
  }
  function looksReceivingPage() {
    var text = nativeBodyText();
    return /Receiving in progress/i.test(text) || /Manually Receive Item/i.test(text) ||
      /Unreceived\s*\d+\s*\/\s*\d+/i.test(text) || /Back to all Purchase Orders/i.test(text) ||
      /Scan Location to submit receives/i.test(text);
  }
  function currentMode() {
    if (looksReceivingPage()) return 'po';
    if (/\/locations\b/i.test(location.pathname)) return 'locations';
    if (/\/inventory\b/i.test(location.pathname)) return 'inventory';
    return 'other';
  }

  var style = document.createElement('style');
  style.id = 'ptx7-pims-tools-style';
  style.textContent =
    'html.ptx7-simple-pims body{font-size:30px!important;overflow-x:hidden!important}' +
    'html.ptx7-simple-pims input,html.ptx7-simple-pims textarea,html.ptx7-simple-pims select{min-height:82px!important;font-size:32px!important;padding:16px!important}' +
    'html.ptx7-simple-pims button{min-height:78px!important;font-size:30px!important;padding:15px 22px!important}' +
    'html.ptx7-simple-pims table{font-size:28px!important;line-height:1.4!important}' +
    'html.ptx7-simple-pims th,html.ptx7-simple-pims td{padding:18px 14px!important}' +
    'html.ptx7-simple-pims h1{font-size:54px!important}html.ptx7-simple-pims h2{font-size:44px!important}' +
    'html.ptx7-simple-pims [role="dialog"]{font-size:30px!important;max-width:96vw!important}' +
    '#ptx7-inventory-root{position:fixed;inset:0 auto auto 0;width:50%;height:50%;zoom:2;z-index:2147483000;display:none;flex-direction:column;background:#f6f8f9;color:#172b3a;font:30px Arial,Helvetica,sans-serif;overflow-y:auto;overflow-x:hidden}' +
    '#ptx7-inventory-root *{box-sizing:border-box}' +
    '#ptx7-inventory-head{position:sticky;top:0;z-index:3;background:#007a83;color:#fff;padding:24px;font-size:52px;font-weight:900;text-align:center;border-bottom:6px solid #005a61}' +
    '#ptx7-inventory-content{padding:24px 24px 150px;max-width:none;width:100%;margin:0 auto}' +
    '#ptx7-inventory-search{display:grid;grid-template-columns:1fr auto;align-items:center;gap:16px;background:#fff;padding:22px;border:5px solid #007a83;border-radius:20px;box-shadow:0 5px 18px #0003}' +
    '#ptx7-inventory-input{width:100%;min-height:100px;border:5px solid #007a83;border-radius:15px;padding:16px 20px;font-size:38px;font-weight:800}' +
    '#ptx7-inventory-submit{min-width:210px;min-height:100px;border:0;border-radius:15px;background:#007a83;color:#fff;font-size:34px;font-weight:900;padding:16px 24px}' +
    '#ptx7-inventory-hint{grid-column:1/-1;color:#394b59;font-weight:800;font-size:27px;line-height:1.35}' +
    '#ptx7-inventory-message{display:none;margin:18px 0;padding:20px;border:4px solid #f0a000;border-radius:14px;background:#fff4e5;color:#8a4b00;font-size:28px;font-weight:900}' +
    '#ptx7-inventory-actions{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin:22px 0}' +
    '#ptx7-inventory-actions button,#ptx7-inventory-detail{min-height:90px;border:0;border-radius:15px;background:#075f67;color:#fff;font-size:29px;font-weight:900;padding:16px}' +
    '#ptx7-inventory-detail{width:100%;background:#fff;color:#172b3a;border:5px solid #007a83;margin:0 0 20px}' +
    '.ptx7-card{background:#fff;border:4px solid #c5d2d8;border-radius:20px;padding:24px;margin:18px 0;box-shadow:0 4px 14px #0002}' +
    '.ptx7-card h2{font-size:42px;margin:0 0 18px;border-bottom:4px solid #007a83;padding-bottom:10px}.ptx7-product{font-size:44px;font-weight:900;line-height:1.2}.ptx7-ndc{font-size:34px;margin-top:12px}' +
    '.ptx7-metrics{display:grid;grid-template-columns:1fr 1fr;gap:18px;margin-top:20px}.ptx7-metric{background:#eef7f8;border:3px solid #9cc9cd;border-radius:15px;padding:20px;font-size:32px;font-weight:900}' +
    '.ptx7-table-wrap{overflow:auto}.ptx7-table{width:100%;border-collapse:collapse;font-size:28px}.ptx7-table th{background:#dce7ea;text-align:left}.ptx7-table th,.ptx7-table td{padding:18px 14px;border-bottom:3px solid #b8c6cc;vertical-align:top}' +
    '.ptx7-po-link{border:0;background:transparent;color:#007a83;text-decoration:underline;font:900 28px Arial;padding:4px;min-height:0}' +
    '.ptx7-empty{color:#394b59;font-size:30px;font-style:italic;min-height:150px;display:flex;align-items:center;justify-content:center;text-align:center}.ptx7-native-copy{white-space:pre-wrap;line-height:1.5;max-height:700px;overflow:auto;font-size:28px}' +
    '#ptx7-full-view-toggle,#ptx7-receive-current-po{position:fixed;right:24px;bottom:240px;z-index:2147483645;display:none;min-height:150px;border:0;border-radius:20px;background:#075f67;color:#fff;font:900 52px Arial;padding:24px 30px;box-shadow:0 7px 22px #0005}' +
    '#ptx7-receive-current-po{left:24px;right:24px;background:#007a83;font-size:60px;border:6px solid #fff}' +
    '#ptx7-route-message{position:fixed;left:18px;right:18px;top:16px;z-index:2147483646;display:none;padding:20px;border:4px solid #f0a000;border-radius:14px;background:#fff4e5;color:#8a4b00;font:900 28px Arial;box-shadow:0 5px 18px #0004}' +
    'html.ptx7-native-action [role="dialog"],html.ptx7-native-action [aria-modal="true"]{position:fixed!important;inset:70px 70px 280px!important;width:auto!important;max-width:none!important;height:auto!important;max-height:none!important;overflow:auto!important;padding:42px!important;font-size:48px!important;border:7px solid #007a83!important;border-radius:24px!important;background:#fff!important;z-index:2147483000!important;box-sizing:border-box!important}' +
    'html.ptx7-native-action [role="dialog"] input,html.ptx7-native-action [role="dialog"] select,html.ptx7-native-action [role="dialog"] button,html.ptx7-native-action [aria-modal="true"] input,html.ptx7-native-action [aria-modal="true"] select,html.ptx7-native-action [aria-modal="true"] button{min-height:96px!important;font-size:42px!important;padding:18px!important}' +
    '@media(max-width:900px){#ptx7-inventory-search{grid-template-columns:90px 1fr}#ptx7-inventory-submit{grid-column:1/-1;width:100%}#ptx7-inventory-actions{grid-template-columns:1fr}.ptx7-metrics{grid-template-columns:1fr}}';
  document.head.appendChild(style);

  var inventoryRoot = document.createElement('section');
  inventoryRoot.id = 'ptx7-inventory-root';
  inventoryRoot.innerHTML =
    '<header id="ptx7-inventory-head">INVENTORY</header>' +
    '<main id="ptx7-inventory-content">' +
      '<div id="ptx7-inventory-search">' +
        '<input id="ptx7-inventory-input" type="text" inputmode="numeric" autocomplete="off" placeholder="Scan medication barcode or enter NDC-11" aria-label="Inventory NDC search">' +
        '<button id="ptx7-inventory-submit" type="button">SEARCH</button>' +
        '<div id="ptx7-inventory-hint">Hardware scans accept UPC, GTIN, GS1, or NDC. Manual entry requires an 11-digit NDC.</div>' +
      '</div>' +
      '<div id="ptx7-inventory-message"></div>' +
      '<div id="ptx7-inventory-actions">' +
        '<button type="button" data-native-control="Adjust Inventory">ADJUST INVENTORY</button>' +
        '<button type="button" data-native-control="Quick Move">QUICK MOVE</button>' +
        '<button type="button" id="ptx7-show-full-inventory">FULL PIMS INVENTORY</button>' +
      '</div>' +
      '<select id="ptx7-inventory-detail" aria-label="Inventory detail">' +
        '<option value="all" selected>SHOW ALL</option><option value="overview">OVERVIEW</option>' +
        '<option value="locations">LOCATIONS</option><option value="incoming">INCOMING POs</option>' +
        '<option value="transactions">TRANSACTIONS</option>' +
      '</select>' +
      '<div id="ptx7-inventory-results"><div class="ptx7-card ptx7-empty">Scan a medication barcode or enter an NDC-11.</div></div>' +
    '</main>';
  document.body.appendChild(inventoryRoot);

  var inventoryInput = inventoryRoot.querySelector('#ptx7-inventory-input');
  var inventoryMessage = inventoryRoot.querySelector('#ptx7-inventory-message');
  var detailSelect = inventoryRoot.querySelector('#ptx7-inventory-detail');
  var results = inventoryRoot.querySelector('#ptx7-inventory-results');

  var fullButton = document.createElement('button');
  fullButton.id = 'ptx7-full-view-toggle';
  fullButton.type = 'button';
  document.body.appendChild(fullButton);

  var receivePoButton = document.createElement('button');
  receivePoButton.id = 'ptx7-receive-current-po';
  receivePoButton.type = 'button';
  receivePoButton.textContent = 'RECEIVE THIS PO';
  document.body.appendChild(receivePoButton);

  var message = document.createElement('div');
  message.id = 'ptx7-route-message';
  document.body.appendChild(message);

  function showMessage(text, inInventory) {
    var target = inInventory ? inventoryMessage : message;
    target.textContent = text;
    target.style.display = 'block';
    clearTimeout(target.hideTimer);
    target.hideTimer = setTimeout(function () { target.style.display = 'none'; }, 5000);
  }

  function fields(root) { return [].slice.call((root || document).querySelectorAll('input,textarea')); }
  function nativeInventoryField() {
    return nativeElements('input,textarea').find(function (input) {
      var label = normalize(input.getAttribute('placeholder') || input.getAttribute('aria-label') || '').toLowerCase();
      return /scan a package|enter an ndc-11|dispensable product asin|medication name|product id/.test(label);
    }) || nativeElements('input,textarea').find(function (input) { return visible(input) && !input.disabled && !input.readOnly; });
  }
  function locationScanField() {
    var dialog = nativeElements('[role="dialog"]').find(visible);
    var scope = dialog || document;
    return fields(scope).filter(function (input) { return !isToolElement(input); }).find(function (input) {
      var label = normalize(input.getAttribute('placeholder') || input.getAttribute('aria-label') || '').toLowerCase();
      return /location barcode|scan.*location/.test(label) || (dialog && /scan a package|enter an ndc-11|product id/.test(label));
    }) || fields(scope).filter(function (input) { return !isToolElement(input); }).find(function (input) {
      return visible(input) && !input.disabled && !input.readOnly;
    });
  }
  function nearbySubmit(input) {
    var scope = input && (input.closest('form,[role="dialog"],section') || (input.parentElement && input.parentElement.parentElement));
    return [].slice.call((scope || document).querySelectorAll('button,input[type="submit"],[role="button"]')).find(function (button) {
      return !isToolElement(button) && visible(button) && /^submit$/i.test(normalize(button.innerText || button.value || button.getAttribute('aria-label')));
    }) || null;
  }
  function setNativeValue(input, value) {
    var descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
    if (descriptor && descriptor.set) descriptor.set.call(input, value); else input.value = value;
    input.dispatchEvent(new Event('input', {bubbles:true}));
    input.dispatchEvent(new Event('change', {bubbles:true}));
  }

  function submitInventorySearch(raw, scannerInput) {
    if (inventorySearchBusy) return false;
    var typed = String(raw == null ? '' : raw).trim();
    // Hardware scanner payloads must reach PIMS exactly as emitted. PIMS
    // understands package UPC/GTIN/GS1 values such as 313811719109. Converting
    // that payload to a guessed NDC-11 can insert padding in the wrong segment.
    var searchValue = scannerInput ? typed : typed.replace(/\D/g, '');
    if (!scannerInput && !/^\d{11}$/.test(searchValue)) {
      showMessage('Manual entry must be exactly 11 digits.', true);
      return false;
    }
    if (scannerInput && searchValue.length < 6) {
      showMessage('The scanner value is incomplete. Scan the package again.', true);
      return false;
    }
    var input = nativeInventoryField();
    var submit = nearbySubmit(input);
    if (!input || !submit || submit.disabled || submit.getAttribute('aria-disabled') === 'true') {
      showMessage('PIMS Inventory search is not ready. Wait a moment and try again.', true);
      return false;
    }
    inventorySearchBusy = true;
    inventoryInput.value = searchValue;
    setNativeValue(input, searchValue);
    lastSubmitted = searchValue;
    lastSubmittedAt = Date.now();
    lastRenderSignature = '';
    transactionWakeRequested = false;
    results.innerHTML = '<div class="ptx7-card"><strong>Searching PIMS for ' + esc(searchValue) + '…</strong></div>';
    submit.click();
    // Clear only our visible capture field after PIMS has received the value.
    // The native PIMS field remains untouched so its validation stays authoritative.
    setTimeout(function () {
      inventoryInput.value = '';
      inventoryFirstAt = 0;
      inventoryEventCount = 0;
      try { inventoryInput.focus({preventScroll:true}); } catch (_) {}
    }, 100);
    setTimeout(function () { inventorySearchBusy = false; }, 700);
    scheduleRender(200);
    scheduleRender(800);
    scheduleRender(1600);
    return true;
  }

  inventoryInput.addEventListener('input', function () {
    if (!inventoryFirstAt) inventoryFirstAt = performance.now();
    inventoryEventCount += 1;
    clearTimeout(inventoryScanTimer);
    inventoryScanTimer = setTimeout(function () {
      var value = normalize(inventoryInput.value);
      var elapsed = performance.now() - inventoryFirstAt;
      var events = inventoryEventCount;
      inventoryFirstAt = 0;
      inventoryEventCount = 0;
      if (value.length < 6) return;
      var scannerFast = events === 1 || elapsed < value.length * 45;
      if (scannerFast && !(value === lastSubmitted && Date.now() - lastSubmittedAt < 1500)) {
        submitInventorySearch(value, true);
      }
    }, 180);
  });
  inventoryInput.addEventListener('keydown', function (event) {
    if (event.key !== 'Enter' && event.key !== 'Tab') return;
    event.preventDefault();
    clearTimeout(inventoryScanTimer);
    var elapsed = inventoryFirstAt ? performance.now() - inventoryFirstAt : Number.MAX_VALUE;
    var scannerFast = inventoryEventCount === 1 || elapsed < normalize(inventoryInput.value).length * 45;
    inventoryFirstAt = 0;
    inventoryEventCount = 0;
    submitInventorySearch(inventoryInput.value, scannerFast);
  });
  inventoryRoot.querySelector('#ptx7-inventory-submit').addEventListener('click', function () {
    submitInventorySearch(inventoryInput.value, false);
  });

  function nativeHeadings() {
    return nativeElements('h1,h2,h3,h4,[role="heading"]').map(function (element) { return normalize(element.innerText); }).filter(Boolean);
  }
  function findTable(requiredPatterns) {
    return nativeElements('table,[role="table"],[role="grid"]').find(function (table) {
      var text = normalize(table.innerText);
      return requiredPatterns.every(function (pattern) { return pattern.test(text); });
    }) || null;
  }
  function tableHtml(table, linkMode) {
    if (!table) return '<div class="ptx7-empty">No information returned by PIMS.</div>';
    var headerCells = [].slice.call(table.querySelectorAll('thead th,[role="columnheader"]'));
    if (!headerCells.length) headerCells = [].slice.call(table.querySelectorAll('tr:first-child th,tr:first-child td'));
    var headers = headerCells.map(function (cell) { return normalize(cell.innerText); });
    var rows = [].slice.call(table.querySelectorAll('tbody tr,[role="row"]')).filter(function (row) {
      return !row.querySelector('[role="columnheader"]') && row.querySelector('td,th,[role="cell"],[role="gridcell"]');
    });
    if (!rows.length) rows = [].slice.call(table.querySelectorAll('tr')).slice(headers.length ? 1 : 0);
    var html = '<div class="ptx7-table-wrap"><table class="ptx7-table">';
    if (headers.length) html += '<thead><tr>' + headers.map(function (header) { return '<th>' + esc(header) + '</th>'; }).join('') + '</tr></thead>';
    html += '<tbody>';
    rows.slice(0, 100).forEach(function (row) {
      var cells = [].slice.call(row.querySelectorAll(':scope > td,:scope > th,:scope > [role="cell"],:scope > [role="gridcell"]'));
      if (!cells.length) return;
      html += '<tr>' + cells.map(function (cell) {
        var text = normalize(cell.innerText);
        var link = linkMode && cell.querySelector('a[href],button,[role="button"]');
        if (link) {
          var action = {href: link.getAttribute && link.getAttribute('href'), element: link};
          var actionIndex = poActions.push(action) - 1;
          return '<td><button type="button" class="ptx7-po-link" data-po-action="' + actionIndex + '">' + esc(text) + '</button></td>';
        }
        return '<td>' + esc(text) + '</td>';
      }).join('') + '</tr>';
    });
    return html + '</tbody></table></div>';
  }
  function sectionContainer(headingPattern) {
    var heading = nativeElements('h1,h2,h3,h4,[role="heading"]').find(function (element) { return headingPattern.test(normalize(element.innerText)); });
    if (!heading) return null;
    var node = heading.closest('section,article,[role="region"]') || heading.parentElement;
    for (var i=0; node && i<6 && node !== document.body; i++, node=node.parentElement) {
      var text=normalize(node.innerText);
      if (/Date/i.test(text) && /Type|Quantity|Reason|User|Onhand/i.test(text)) return node;
    }
    return heading.parentElement;
  }
  function sectionText(headingPattern) {
    var section=sectionContainer(headingPattern);
    return normalize(section && section.innerText);
  }
  function wakeTransactionHistory() {
    if (transactionWakeRequested) return;
    var section=sectionContainer(/Transaction History/i);
    if (!section) return;
    transactionWakeRequested=true;
    try { section.scrollIntoView({block:'center'}); } catch (_) {}
    setTimeout(function(){lastRenderSignature='';renderInventory();},500);
  }

  function renderInventory() {
    if (currentMode() !== 'inventory' || !inventorySimple) return;
    var text = nativeBodyText();
    var headings = nativeHeadings();
    var product = headings.find(function (heading) {
      return !/^Inventory$/i.test(heading) && !/Pharmacy Inventory Management Console|Incoming Purchases|Transaction History|Related/i.test(heading);
    }) || '';
    var ndcMatch = text.match(/\bNDC\s*-?\s*(\d{9,14})\b/i);
    var ndc = ndcMatch ? ndcMatch[1] : '';
    var onhandMatch = text.match(/Onhand Quantity:\s*([\d.,-]+)/i);
    var valueMatch = text.match(/\bValue:\s*(\$?[\d,.-]+)/i);
    var relatedMatch = text.match(/Related Dispensable Products\s*\((\d+)\)/i);
    var selection = detailSelect.value;
    if (selection === 'transactions' || selection === 'all') wakeTransactionHistory();
    var locationsTable = findTable([/Subarea/i, /Location/i, /Quantity/i]);
    var incomingTable = findTable([/PO Number/i, /Receiv/i]);
    var transactionTable = findTable([/Date/i, /Quantity/i, /Onhand After|Reason|User/i]);
    var transactionFallback = sectionText(/Transaction History/i);
    var signature = [selection, product, ndc, onhandMatch && onhandMatch[1], valueMatch && valueMatch[1], relatedMatch && relatedMatch[1],
      locationsTable && normalize(locationsTable.innerText), incomingTable && normalize(incomingTable.innerText),
      transactionTable && normalize(transactionTable.innerText), transactionFallback].join('|');
    if (signature === lastRenderSignature) return;
    lastRenderSignature = signature;
    poActions = [];

    if (!product && !ndc && !onhandMatch) {
      results.innerHTML = '<div class="ptx7-card ptx7-empty">Scan a medication barcode or enter an NDC-11.</div>';
      return;
    }
    var overview = '<section class="ptx7-card"><div class="ptx7-product">' + esc(product || 'Inventory product') + '</div>' +
      '<div class="ptx7-ndc">NDC: ' + esc(ndc || 'Not returned') + '</div>' +
      '<div class="ptx7-metrics"><div class="ptx7-metric">On-hand: ' + esc(onhandMatch ? onhandMatch[1] : 'Not returned') + '</div>' +
      '<div class="ptx7-metric">Value: ' + esc(valueMatch ? valueMatch[1] : 'Not returned') + '</div></div>' +
      '<div style="margin-top:13px;font-weight:800">Related products: ' + esc(relatedMatch ? relatedMatch[1] : 'Not returned') + '</div></section>';
    var html = '';
    if (selection === 'overview' || selection === 'all') html += overview;
    if (selection === 'locations' || selection === 'all') html += '<section class="ptx7-card"><h2>LOCATIONS</h2>' + tableHtml(locationsTable, false) + '</section>';
    if (selection === 'incoming' || selection === 'all') html += '<section class="ptx7-card"><h2>INCOMING POs</h2>' + tableHtml(incomingTable, true) + '</section>';
    if (selection === 'transactions' || selection === 'all') {
      var transactionContent = transactionTable ? tableHtml(transactionTable, false) :
        (transactionFallback ? '<div class="ptx7-native-copy">' + esc(transactionFallback) + '</div>' : '<div class="ptx7-empty">No transaction history returned by PIMS.</div>');
      html += '<section class="ptx7-card"><h2>TRANSACTIONS</h2>' + transactionContent + '</section>';
    }
    results.innerHTML = html || overview;
  }

  function scheduleRender(delay) {
    clearTimeout(renderTimer);
    renderTimer = setTimeout(renderInventory, delay || 100);
  }
  detailSelect.addEventListener('change', function () { transactionWakeRequested=false; lastRenderSignature = ''; renderInventory(); });
  results.addEventListener('click', function (event) {
    var button = event.target.closest && event.target.closest('[data-po-action]');
    if (!button) return;
    var action = poActions[Number(button.getAttribute('data-po-action'))];
    if (!action) return;
    inventorySimple = false;
    inventoryRoot.style.display = 'none';
    if (action.href) location.href = action.href;
    else if (action.element && document.documentElement.contains(action.element)) action.element.click();
  });

  function nativeButton(label) {
    return nativeElements('button,[role="button"],a').find(function (button) {
      return normalize(button.innerText || button.getAttribute('aria-label')).toLowerCase() === label.toLowerCase();
    }) || nativeElements('button,[role="button"],a').find(function (button) {
      return normalize(button.innerText || button.getAttribute('aria-label')).toLowerCase().indexOf(label.toLowerCase()) >= 0;
    });
  }
  function showNativeInventory(targetLabel) {
    var target = targetLabel ? nativeButton(targetLabel) : null;
    if (targetLabel && !target) {
      showMessage(targetLabel + ' is not available for this product.', true);
      return;
    }
    inventorySimple = false;
    nativeActionActive = !!target;
    document.documentElement.classList.toggle('ptx7-native-action', nativeActionActive);
    inventoryRoot.style.display = 'none';
    fullButton.textContent = 'RETURN TO SIMPLE INVENTORY';
    fullButton.style.display = 'block';
    // This is the user's one tap, forwarded to the public native PIMS control.
    // No React internals or private handlers are invoked.
    if (target) setTimeout(function () { if (document.documentElement.contains(target)) target.click(); }, 0);
  }
  inventoryRoot.querySelector('#ptx7-show-full-inventory').addEventListener('click', function () { showNativeInventory(''); });
  [].slice.call(inventoryRoot.querySelectorAll('[data-native-control]')).forEach(function (button) {
    button.addEventListener('click', function () { showNativeInventory(button.getAttribute('data-native-control')); });
  });

  function armLocationInput(input) {
    if (!input || input.dataset.ptx7Armed === 'true') return;
    input.dataset.ptx7Armed = 'true';
    var firstAt = 0, eventCount = 0;
    input.addEventListener('input', function () {
      if (!firstAt) firstAt = performance.now();
      eventCount += 1;
      clearTimeout(locationAutoTimer);
      locationAutoTimer = setTimeout(function () {
        var value = normalize(input.value);
        var elapsed = performance.now() - firstAt;
        var events = eventCount;
        firstAt = 0; eventCount = 0;
        if (value.length < 6) return;
        if (value === lastSubmitted && Date.now() - lastSubmittedAt < 1500) return;
        var submit = nearbySubmit(input);
        if (!submit || submit.disabled || submit.getAttribute('aria-disabled') === 'true') {
          showMessage('PIMS Submit is unavailable. Use the visible PIMS Submit button.', false);
          return;
        }
        if (events > 1 && elapsed >= value.length * 45) return;
        lastSubmitted = value; lastSubmittedAt = Date.now();
        submit.click();
      }, 180);
    }, true);
    input.addEventListener('keydown', function (event) {
      if (event.key === 'Enter' || event.key === 'Tab') {
        lastSubmitted = normalize(input.value); lastSubmittedAt = Date.now();
      }
    }, true);
  }

  function productRemovalDetails(button) {
    var row = button.closest('tbody tr,[role="row"]');
    if (!row) return null;
    var text = normalize(row.innerText);
    var productId = (text.match(/\b\d{9,14}\b/) || [''])[0];
    if (!productId) return null;
    var cells = [].slice.call(row.querySelectorAll(':scope > td,:scope > th,:scope > [role="cell"],:scope > [role="gridcell"]'));
    var quantity = cells.length ? normalize(cells[cells.length - 2] && cells[cells.length - 2].innerText) : '';
    return {row:row, productId:productId, productName:text.replace(productId, '').trim(), quantity:quantity || 'unavailable'};
  }
  document.addEventListener('click', function (event) {
    if (currentMode() !== 'locations') return;
    var button = event.target.closest && event.target.closest('button,[role="button"]');
    if (!button || isToolElement(button)) return;
    var details = productRemovalDetails(button);
    if (!details) return;
    var label = normalize(button.innerText || button.getAttribute('aria-label') || button.getAttribute('title')).toLowerCase();
    var rowButtons = [].slice.call(details.row.querySelectorAll('button,[role="button"]'));
    var likelyRemove = /remove|delete|disassociate/.test(label) || (rowButtons.length === 1 && !label);
    if (!likelyRemove || button.dataset.ptx7RemovalConfirmed === 'true') return;
    event.preventDefault(); event.stopImmediatePropagation();
    var approved = confirm('Remove?\n\nProduct ID: ' + details.productId + '\nProduct: ' + details.productName + '\nQuantity: ' + details.quantity + '\n\nRemove this product from the current location?');
    if (!approved) return;
    button.dataset.ptx7RemovalConfirmed = 'true';
    button.click();
    setTimeout(function () { delete button.dataset.ptx7RemovalConfirmed; }, 1000);
  }, true);

  fullButton.addEventListener('click', function () {
    var mode = currentMode();
    if (mode === 'inventory') {
      inventorySimple = true;
      nativeActionActive = false;
      document.documentElement.classList.remove('ptx7-native-action');
      fullButton.style.display = 'none';
      inventoryRoot.style.display = 'flex';
      lastRenderSignature = '';
      renderInventory();
      setTimeout(function () { try { inventoryInput.focus({preventScroll:true}); } catch (_) {} }, 50);
      return;
    }
    if (mode === 'locations') {
      locationsSimple = !locationsSimple;
      document.documentElement.classList.toggle('ptx7-simple-pims', locationsSimple);
      fullButton.textContent = locationsSimple ? 'VIEW FULL LOCATION MANAGEMENT' : 'RETURN TO SIMPLE VIEW';
    }
  });

  receivePoButton.addEventListener('click', function () {
    try {
      if (window.PTX7Host && window.PTX7Host.openCurrentPoReceiving) {
        window.PTX7Host.openCurrentPoReceiving();
        return;
      }
    } catch (_) {}
    if (window.__ptx7Rx && window.__ptx7Rx.open) window.__ptx7Rx.open();
  });

  function maintain() {
    var mode = currentMode();
    var enlarged = mode === 'inventory' || mode === 'locations' || mode === 'po';
    document.documentElement.classList.toggle('ptx7-simple-pims', enlarged);
    inventoryRoot.style.display = mode === 'inventory' && inventorySimple ? 'flex' : 'none';
    receivePoButton.style.display = mode === 'po' ? 'block' : 'none';
    if (mode === 'locations') {
      fullButton.style.display = 'block';
      fullButton.textContent = locationsSimple ? 'VIEW FULL LOCATION MANAGEMENT' : 'RETURN TO SIMPLE VIEW';
      var input = locationScanField();
      if (input) {
        armLocationInput(input);
        var active = document.activeElement;
        var userEditing = active && /INPUT|TEXTAREA|SELECT/.test(active.tagName) && active !== input;
        if (!userEditing) try { input.focus({preventScroll:true}); } catch (_) { try { input.focus(); } catch (_) {} }
      }
    } else if (mode === 'inventory' && !inventorySimple) {
      fullButton.style.display = 'block';
      fullButton.textContent = 'RETURN TO SIMPLE INVENTORY';
    } else {
      fullButton.style.display = 'none';
    }
    if (mode === 'inventory' && inventorySimple) {
      scheduleRender(120);
      var activeInventory = document.activeElement;
      if (!activeInventory || !inventoryRoot.contains(activeInventory)) {
        try { inventoryInput.focus({preventScroll:true}); } catch (_) {}
      }
    }
    if (!document.documentElement.contains(inventoryRoot)) document.body.appendChild(inventoryRoot);
    if (!document.documentElement.contains(fullButton)) document.body.appendChild(fullButton);
    if (!document.documentElement.contains(receivePoButton)) document.body.appendChild(receivePoButton);
    if (!document.documentElement.contains(message)) document.body.appendChild(message);
  }

  new MutationObserver(function () {
    clearTimeout(maintain.timer);
    maintain.timer = setTimeout(maintain, 120);
  }).observe(document.documentElement, {subtree:true, childList:true});
  maintain();
  setInterval(maintain, 1000);
  window.__ptx7PimsTools = {showInventory:function () {
    inventorySimple = true;
    nativeActionActive = false;
    document.documentElement.classList.remove('ptx7-native-action');
    fullButton.style.display='none';
    maintain();
    setTimeout(function(){try{inventoryInput.focus({preventScroll:true});}catch(_){}},0);
  }, inventoryUrl:INVENTORY_URL};
})();
