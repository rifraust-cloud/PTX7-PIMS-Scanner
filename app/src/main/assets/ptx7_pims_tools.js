/* PTX7 simplified Inventory and Stock Location Manager — PIMS DOM adapter. */
(function () {
  'use strict';
  if (window.__ptx7PimsToolsInstalled) return;
  window.__ptx7PimsToolsInstalled = true;

  var route = location.pathname;
  var mode = /\/locations\b/i.test(route) ? 'locations' : (/\/inventory\b/i.test(route) ? 'inventory' : 'other');
  if (mode === 'other') return;

  var style = document.createElement('style');
  style.id = 'ptx7-pims-tools-style';
  style.textContent =
    'html.ptx7-simple-pims body{font-size:18px!important}' +
    'html.ptx7-simple-pims input,html.ptx7-simple-pims textarea,html.ptx7-simple-pims select{min-height:54px!important;font-size:20px!important;padding:10px!important}' +
    'html.ptx7-simple-pims button{min-height:52px!important;font-size:18px!important;padding:10px 16px!important}' +
    'html.ptx7-simple-pims table{font-size:18px!important;line-height:1.35!important}' +
    'html.ptx7-simple-pims th,html.ptx7-simple-pims td{padding:12px 10px!important}' +
    'html.ptx7-simple-pims h1{font-size:36px!important}html.ptx7-simple-pims h2{font-size:28px!important}' +
    'html.ptx7-simple-pims [role="dialog"]{font-size:19px!important;max-width:94vw!important}' +
    '#ptx7-full-view-toggle{position:fixed;right:12px;bottom:94px;z-index:2147483645;min-height:54px;border:0;border-radius:10px;background:#075f67;color:#fff;font:900 17px Arial;padding:10px 15px;box-shadow:0 4px 14px #0005}' +
    '#ptx7-route-message{position:fixed;left:12px;right:12px;top:10px;z-index:2147483645;display:none;padding:12px;border-radius:9px;background:#fff4e5;color:#8a4b00;font:900 17px Arial;box-shadow:0 4px 14px #0004}';
  document.head.appendChild(style);
  document.documentElement.classList.add('ptx7-simple-pims');

  var fullButton = document.createElement('button');
  fullButton.id = 'ptx7-full-view-toggle';
  fullButton.type = 'button';
  fullButton.textContent = mode === 'locations' ? 'VIEW FULL LOCATION MANAGEMENT' : 'VIEW FULL INVENTORY';
  document.body.appendChild(fullButton);
  var message = document.createElement('div');
  message.id = 'ptx7-route-message';
  document.body.appendChild(message);

  function normalize(value) { return String(value == null ? '' : value).replace(/\s+/g, ' ').trim(); }
  function visible(element) {
    if (!element) return false;
    var css = getComputedStyle(element), rect = element.getBoundingClientRect();
    return css.display !== 'none' && css.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
  }
  function showMessage(text) {
    message.textContent = text; message.style.display = 'block';
    clearTimeout(showMessage.timer); showMessage.timer = setTimeout(function(){ message.style.display = 'none'; }, 4500);
  }
  function fields(root) { return [].slice.call((root || document).querySelectorAll('input,textarea')); }
  function scanField() {
    var dialog = [].slice.call(document.querySelectorAll('[role="dialog"]')).find(visible);
    var scope = dialog || document;
    return fields(scope).find(function(input) {
      var label = normalize(input.getAttribute('placeholder') || input.getAttribute('aria-label') || '').toLowerCase();
      if (dialog && /scan a package|enter an ndc-11|product id/.test(label)) return true;
      if (mode === 'locations') return /location barcode|scan.*location/.test(label);
      return /scan a package|enter an ndc|product id|medication name/.test(label);
    }) || fields(scope).find(function(input){ return visible(input) && !input.disabled && !input.readOnly; });
  }
  function nearbySubmit(input) {
    var scope = input && (input.closest('form,[role="dialog"],section') || input.parentElement && input.parentElement.parentElement);
    var buttons = [].slice.call((scope || document).querySelectorAll('button,input[type="submit"],[role="button"]'));
    return buttons.find(function(button){ return visible(button) && /^submit$/i.test(normalize(button.innerText || button.value || button.getAttribute('aria-label'))); }) || null;
  }

  var lastSubmitted = '', lastSubmittedAt = 0, autoTimer = null;
  function armInput(input) {
    if (!input || input.dataset.ptx7Armed === 'true') return;
    input.dataset.ptx7Armed = 'true';
    var firstAt = 0, eventCount = 0;
    input.addEventListener('input', function() {
      if (!firstAt) firstAt = performance.now();
      eventCount += 1;
      clearTimeout(autoTimer);
      autoTimer = setTimeout(function() {
        var value = String(input.value || '').trim();
        var elapsed = performance.now() - firstAt;
        firstAt = 0; eventCount = 0;
        if (value.length < 6) return;
        var now = Date.now();
        if (value === lastSubmitted && now - lastSubmittedAt < 1500) return;
        var submit = nearbySubmit(input);
        if (!submit || submit.disabled || submit.getAttribute('aria-disabled') === 'true') {
          showMessage('PIMS Submit is unavailable. Use the visible PIMS Submit button.');
          return;
        }
        // A single input event can be an Android scanner commitText. Multiple
        // events must still be scanner-fast; human typing is never auto-submitted.
        if (eventCount > 1 && elapsed >= value.length * 45) return;
        lastSubmitted = value; lastSubmittedAt = now;
        submit.click();
      }, 180);
    }, true);
    input.addEventListener('keydown', function(event) {
      if (event.key === 'Enter' || event.key === 'Tab') {
        lastSubmitted = String(input.value || '').trim(); lastSubmittedAt = Date.now();
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
    return { row: row, productId: productId, productName: text.replace(productId, '').trim(), quantity: quantity || 'unavailable' };
  }

  document.addEventListener('click', function(event) {
    if (mode !== 'locations') return;
    var button = event.target.closest && event.target.closest('button,[role="button"]');
    if (!button || button.closest('#ptx7-route-message,#ptx7-full-view-toggle')) return;
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
    setTimeout(function(){ delete button.dataset.ptx7RemovalConfirmed; }, 1000);
  }, true);

  fullButton.addEventListener('click', function() {
    var simple = document.documentElement.classList.toggle('ptx7-simple-pims');
    fullButton.textContent = simple ?
      (mode === 'locations' ? 'VIEW FULL LOCATION MANAGEMENT' : 'VIEW FULL INVENTORY') :
      'RETURN TO SIMPLE VIEW';
  });

  function maintain() {
    var input = scanField();
    if (input) {
      armInput(input);
      var active = document.activeElement;
      var userEditing = active && /INPUT|TEXTAREA|SELECT/.test(active.tagName) && active !== input;
      if (!userEditing) {
        try { input.focus({preventScroll:true}); } catch (_) { try { input.focus(); } catch (_) {} }
      }
    }
    if (!document.documentElement.contains(fullButton)) document.body.appendChild(fullButton);
    if (!document.documentElement.contains(message)) document.body.appendChild(message);
  }
  new MutationObserver(function(){ clearTimeout(maintain.timer); maintain.timer = setTimeout(maintain, 100); })
    .observe(document.documentElement, {subtree:true,childList:true});
  maintain(); setInterval(maintain, 1200);
})();
