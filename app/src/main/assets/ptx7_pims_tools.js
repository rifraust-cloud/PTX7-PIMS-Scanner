(function () {
  'use strict';
  if (window.__ptx7PimsToolsInstalled) return;
  window.__ptx7PimsToolsInstalled = true;

  var INVENTORY_URL = 'https://console.inventory.pharmacy.amazon.dev/inventory?facility=PTX7';
  var LOCATIONS_URL = 'https://console.inventory.pharmacy.amazon.dev/locations?facility=PTX7';
  var LOCATION_CODE = /\b[A-Z]{2,}[A-Z0-9]*\d{2,}(?:-[A-Z0-9]+)+\b/g;
  var GOTO_KEY = 'ptx7_goto_location';
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
  var locationSearchBusy = false;
  var locationRenderTimer = null;
  var lastLocationSignature = '';
  var nativeDialogSeen = false;
  var nativeActionStartedAt = 0;

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
    return !!(element && element.closest && element.closest('#ptx7-buddy-sheet,#ptx7-adjust-root,#ptx7-remove-confirm,#ptx7-inventory-root,#ptx7-location-root,#ptx7-full-view-toggle,#ptx7-route-message,#ptx7-receive-current-po,#ptx7-rx-root'));
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
  // Receiving owns the screen and scanner focus whenever its overlay is open.
  function receivingOpen() {
    try { return !!(window.__ptx7Rx && window.__ptx7Rx.isOpen && window.__ptx7Rx.isOpen()); } catch (_) { return false; }
  }
  // Route first (cheap); full-page text is read only off the known routes.
  function currentMode() {
    var path = location.pathname;
    if (document.querySelector('button[data-testid="submit-receives"]')) return 'po';
    if (/\/locations\b/i.test(path)) return 'locations';
    if (/\/inventory\b/i.test(path)) return 'inventory';
    return looksReceivingPage() ? 'po' : 'other';
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
    '#ptx7-inventory-root{position:fixed;inset:0 auto auto 0;width:50%;height:50%;transform:scale(2);transform-origin:top left;z-index:2147483000;display:none;flex-direction:column;background:#f6f8f9;color:#172b3a;font:30px Arial,Helvetica,sans-serif;overflow-y:auto;overflow-x:hidden}' +
    '#ptx7-inventory-root *,#ptx7-location-root *{box-sizing:border-box}' +
    '#ptx7-location-root{position:fixed;inset:0 auto auto 0;width:50%;height:50%;transform:scale(2);transform-origin:top left;z-index:2147483000;display:none;flex-direction:column;background:#f6f8f9;color:#172b3a;font:30px Arial,Helvetica,sans-serif;overflow-y:auto;overflow-x:hidden}' +
    '#ptx7-location-head{position:sticky;top:0;z-index:3;background:#007a83;color:#fff;padding:24px;font-size:52px;font-weight:900;text-align:center;border-bottom:6px solid #005a61}' +
    '#ptx7-location-content{padding:24px 24px 150px;width:100%}' +
    '#ptx7-location-search{display:grid;grid-template-columns:1fr auto;gap:16px;background:#fff;padding:22px;border:5px solid #007a83;border-radius:20px;box-shadow:0 5px 18px #0003}' +
    '#ptx7-location-input{width:100%;min-height:100px;border:5px solid #007a83;border-radius:15px;padding:16px 20px;font-size:38px;font-weight:800}' +
    '#ptx7-location-submit{min-width:210px;min-height:100px;border:0;border-radius:15px;background:#007a83;color:#fff;font-size:34px;font-weight:900;padding:16px 24px}' +
    '#ptx7-location-hint{grid-column:1/-1;color:#394b59;font-weight:800;font-size:27px}' +
    '#ptx7-location-actions{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin:22px 0}' +
    '#ptx7-location-actions button{min-height:90px;border:0;border-radius:15px;background:#075f67;color:#fff;font-size:29px;font-weight:900;padding:16px}' +
    '#ptx7-location-results .ptx7-table{font-size:28px}' +
    '#ptx7-inventory-input:focus,#ptx7-location-input:focus{outline:none;border-color:#f0a000;box-shadow:0 0 0 8px #f0a00066;animation:ptx7pulse 1.4s ease-in-out infinite}' +
    '@keyframes ptx7pulse{0%,100%{box-shadow:0 0 0 6px #f0a00055}50%{box-shadow:0 0 0 14px #f0a00022}}' +
    '#ptx7-inventory-input,#ptx7-location-input{background:#fff url("data:image/svg+xml;utf8,<svg xmlns=\'http://www.w3.org/2000/svg\' viewBox=\'0 0 60 30\'><g fill=\'%23007a83\' opacity=\'.22\'><rect x=\'2\' y=\'3\' width=\'3\' height=\'24\'/><rect x=\'7\' y=\'3\' width=\'1.5\' height=\'24\'/><rect x=\'11\' y=\'3\' width=\'4\' height=\'24\'/><rect x=\'17\' y=\'3\' width=\'1.5\' height=\'24\'/><rect x=\'21\' y=\'3\' width=\'3\' height=\'24\'/><rect x=\'26\' y=\'3\' width=\'1.5\' height=\'24\'/><rect x=\'30\' y=\'3\' width=\'4.5\' height=\'24\'/><rect x=\'37\' y=\'3\' width=\'1.5\' height=\'24\'/><rect x=\'41\' y=\'3\' width=\'3\' height=\'24\'/><rect x=\'47\' y=\'3\' width=\'1.5\' height=\'24\'/><rect x=\'51\' y=\'3\' width=\'4\' height=\'24\'/></g></svg>") no-repeat center/120px 60px!important}' +
    '#ptx7-inventory-input:not(:placeholder-shown),#ptx7-location-input:not(:placeholder-shown){background-image:none!important}' +
    '.ptx7-scan-label{grid-column:1/-1;font:900 40px Arial;color:#005a61;text-align:center;letter-spacing:1px}' +
    '.ptx7-remove-btn{min-height:76px;min-width:170px;border:0;border-radius:14px;background:#b42318;color:#fff;font:900 28px Arial;padding:10px 16px}' +
    '#ptx7-remove-confirm{position:fixed;inset:0;z-index:2147483646;display:none;align-items:center;justify-content:center;background:#0008}' +
    '#ptx7-remove-confirm .box{width:86%;background:#fff;border:7px solid #b42318;border-radius:24px;padding:34px;font:30px Arial;color:#172b3a}' +
    '#ptx7-remove-confirm h2{font:900 52px Arial;color:#b42318;margin:0 0 18px;text-align:center}' +
    '#ptx7-remove-confirm .row{display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-top:28px}' +
    '#ptx7-remove-confirm button{min-height:110px;border:0;border-radius:18px;font:900 40px Arial}' +
    '.ptx7-loc-link{display:inline-block;margin:6px 8px 6px 0;min-height:70px;border:4px solid #007a83;border-radius:14px;background:#fff;color:#007a83;font:900 30px Arial;padding:10px 18px;text-decoration:underline}' +
    '.ptx7-scroll{max-height:30vh;overflow-y:auto;-webkit-overflow-scrolling:touch;border:4px solid #c5d2d8;border-radius:16px;padding:8px;background:#f6f8f9}' +
    '.ptx7-po-card{display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;align-items:center;background:#fff;border:4px solid #007a83;border-radius:16px;padding:16px;margin:10px 0}' +
    '.ptx7-po-card .po{grid-column:1/-1;min-height:84px;border:0;border-radius:14px;background:#007a83;color:#fff;font:900 40px Arial;text-align:left;padding:12px 20px}' +
    '.ptx7-po-card .k{font:800 24px Arial;color:#394b59}.ptx7-po-card .v{font:900 38px Arial;color:#172b3a}' +
    '.ptx7-yes{color:#087f3f!important}.ptx7-no{color:#b42318!important}' +
    '.ptx7-tx{background:#fff;border-left:10px solid #007a83;border-radius:12px;padding:14px 18px;margin:10px 0;font:28px Arial;line-height:1.35}' +
    '.ptx7-tx .top{display:flex;justify-content:space-between;gap:12px;font-weight:900;font-size:30px}.ptx7-tx .neg{color:#b42318}.ptx7-tx .pos{color:#087f3f}' +
    '.ptx7-dates{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin:0 0 16px}' +
    '.ptx7-date-btn{position:relative;min-height:110px;border:5px solid #007a83;border-radius:16px;background:#fff;color:#172b3a;font:900 34px Arial;padding:10px;overflow:hidden}' +
    '.ptx7-date-btn small{display:block;font:800 22px Arial;color:#394b59}' +
    '.ptx7-date-btn input{position:absolute;inset:0;opacity:0;width:100%;height:100%}' +
    '#ptx7-adjust-root{position:fixed;inset:0 auto auto 0;width:50%;height:50%;transform:scale(2);transform-origin:top left;z-index:2147483100;display:none;flex-direction:column;background:#f6f8f9;color:#172b3a;font:30px Arial,Helvetica,sans-serif;overflow-y:auto;overflow-x:hidden}' +
    '#ptx7-adjust-root *{box-sizing:border-box}' +
    '.ptx7-adj-head{position:sticky;top:0;z-index:3;background:#007a83;color:#fff;padding:22px;font:900 46px Arial;text-align:center;border-bottom:6px solid #005a61}' +
    '.ptx7-adj-pims{position:absolute;right:14px;top:18px;min-height:60px;border:3px solid #fff;border-radius:12px;background:transparent;color:#fff;font:900 20px Arial;padding:6px 12px}' +
    '.ptx7-adj-body{padding:22px 22px 170px}' +
    '.ptx7-adj-prod{background:#fff;border:4px solid #c5d2d8;border-radius:18px;padding:18px;font:900 32px Arial;line-height:1.2}.ptx7-adj-prod small{display:block;font:700 24px Arial;color:#59636b;margin-top:8px}' +
    '.ptx7-adj-title{font:900 34px Arial;color:#005a61;margin:24px 4px 12px;letter-spacing:1px}' +
    '.ptx7-adj-label{font:900 24px Arial;color:#394b59;margin:18px 4px 8px;letter-spacing:1px}' +
    '.ptx7-adj-tiles{display:grid;grid-template-columns:1fr 1fr;gap:14px}' +
    '.ptx7-adj-btn{min-height:96px;border:0;border-radius:18px;font:900 30px Arial;padding:14px}' +
    '.ptx7-adj-btn.tile{background:#fff;color:#172b3a;border:5px solid #c5d2d8}.ptx7-adj-btn.tile.on{border-color:#007a83;background:#e6f4f5;color:#005a61}' +
    '.ptx7-adj-btn.primary{background:#007a83;color:#fff}.ptx7-adj-btn.ghost{background:#fff;color:#007a83;border:4px solid #007a83}.ptx7-adj-btn.danger{background:#b42318;color:#fff}.ptx7-adj-btn.wide{width:100%;margin-top:16px}' +
    '.ptx7-adj-nav{display:grid;grid-template-columns:1fr 1.4fr;gap:16px;margin-top:26px}' +
    '.ptx7-adj-comment{width:100%;min-height:170px;border:5px solid #b42318;border-radius:16px;padding:16px;font:30px Arial}' +
    '.ptx7-adj-card{background:#fff;border:4px solid #c5d2d8;border-radius:18px;padding:18px;margin:16px 0}.ptx7-adj-card.on{border-color:#007a83;background:#f0f9fa}' +
    '.ptx7-adj-scan{width:100%;min-height:100px;border:5px solid #007a83;border-radius:15px;padding:14px 18px;font:900 36px Arial}' +
    '.ptx7-adj-scan:focus{outline:none;border-color:#f0a000;box-shadow:0 0 0 8px #f0a00055}' +
    '.ptx7-adj-area{font:900 36px Arial;color:#005a61;padding:6px 0 12px}' +
    '.ptx7-adj-qty{display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;text-align:center;font:900 38px Arial}.ptx7-adj-qty small{display:block;font:800 20px Arial;color:#59636b}' +
    '.ptx7-adj-total{background:#fff4e5;border:4px solid #f0a000;border-radius:14px;padding:16px;font:900 28px Arial;color:#8a4b00}' +
    '.ptx7-adj-hint{font:700 24px Arial;color:#59636b;margin:12px 4px}' +
    '.ptx7-wheel{position:relative;height:276px;margin-top:10px;background:#fff;border:4px solid #c5d2d8;border-radius:18px;overflow:hidden}' +
    '.ptx7-wheel-band{position:absolute;left:0;right:0;top:92px;height:92px;border-top:4px solid #007a83;border-bottom:4px solid #007a83;background:#e6f4f5;pointer-events:none}' +
    '.ptx7-wheel-list{position:relative;height:100%;overflow-y:scroll;scroll-snap-type:y mandatory;padding:92px 0;scrollbar-width:none}' +
    '.ptx7-wheel-list::-webkit-scrollbar{display:none}' +
    '.ptx7-wheel-item{height:92px;line-height:92px;text-align:center;scroll-snap-align:center;font:700 30px Arial;color:#9aa5ad;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;padding:0 12px}' +
    '.ptx7-wheel-item.sel{font:900 38px Arial;color:#172b3a}' +
    '.ptx7-adj-confirm{position:fixed;inset:0;z-index:5;display:flex;align-items:center;justify-content:center;background:#0008}' +
    '.ptx7-adj-confirm .box{width:88%;background:#fff;border:7px solid #b42318;border-radius:24px;padding:30px}.ptx7-adj-confirm h2{font:900 44px Arial;color:#b42318;margin:0 0 14px;text-align:center}.ptx7-adj-confirm p{font:800 30px Arial;text-align:center}' +
    '#ptx7-buddy-bar{display:grid;grid-template-columns:1.4fr 1fr;gap:16px;margin:18px 0 0}' +
    '.ptx7-buddy-btn{min-height:92px;border:0;border-radius:16px;font:900 30px Arial;padding:12px}' +
    '.ptx7-buddy-btn.on{background:#087f3f;color:#fff}.ptx7-buddy-btn.off{background:#e5e9ec;color:#394b59}.ptx7-buddy-btn.cfg{background:#fff;color:#007a83;border:4px solid #007a83}' +
    '#ptx7-buddy-sheet{position:fixed;inset:0;z-index:6;display:none;background:#0008;align-items:flex-start;justify-content:center;overflow-y:auto}' +
    '#ptx7-buddy-sheet .box{width:94%;margin:30px 0 200px;background:#fff;border:6px solid #007a83;border-radius:24px;padding:26px}' +
    '#ptx7-buddy-sheet h2{font:900 44px Arial;color:#005a61;margin:0 0 6px;text-align:center}' +
    '#ptx7-buddy-sheet .lbl{font:900 24px Arial;color:#394b59;margin:22px 0 10px;letter-spacing:1px}' +
    '.ptx7-buddy-tiles{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}.ptx7-buddy-tiles.two{grid-template-columns:1fr 1fr}' +
    '.ptx7-buddy-tile{min-height:86px;border:5px solid #c5d2d8;border-radius:16px;background:#fff;color:#172b3a;font:900 26px Arial}.ptx7-buddy-tile.sel{border-color:#007a83;background:#e6f4f5;color:#005a61}' +
    '.ptx7-buddy-voice{width:100%;min-height:96px;border:5px solid #007a83;border-radius:16px;font:800 28px Arial;padding:10px;background:#fff}' +
    '#ptx7-buddy-last{margin-top:14px;font:800 26px Arial;color:#087f3f;text-align:center;min-height:34px}' +
    '.ptx7-type-btn{grid-column:1/-1;min-height:80px;border:4px solid #007a83;border-radius:15px;background:#fff;color:#007a83;font-size:30px;font-weight:900}' +
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
        '<div class="ptx7-scan-label">SCAN MEDICATION BARCODE</div>' +
        '<input id="ptx7-inventory-input" type="text" inputmode="none" autocomplete="off" placeholder="" aria-label="Inventory NDC search">' +
        '<button id="ptx7-inventory-submit" type="button">SEARCH</button>' +
        '<button id="ptx7-inventory-type" class="ptx7-type-btn" type="button">\u2328 TYPE NDC-11</button>' +
      '</div>' +
      '<div id="ptx7-buddy-bar"><button type="button" id="ptx7-buddy-toggle" class="ptx7-buddy-btn on">\uD83D\uDD0A LOCATION BUDDY ON</button>' +
        '<button type="button" id="ptx7-buddy-config" class="ptx7-buddy-btn cfg">\u2699 VOICE &amp; SPEED</button></div>' +
      '<div id="ptx7-buddy-last"></div>' +
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
      '<div id="ptx7-inventory-results"></div>' +
    '</main>';
  document.body.appendChild(inventoryRoot);

  var locationRoot = document.createElement('section');
  locationRoot.id = 'ptx7-location-root';
  locationRoot.innerHTML =
    '<header id="ptx7-location-head">LOCATIONS</header>' +
    '<main id="ptx7-location-content">' +
      '<div id="ptx7-location-search">' +
        '<div class="ptx7-scan-label">SCAN LOCATION BARCODE</div>' +
        '<input id="ptx7-location-input" type="text" inputmode="none" autocomplete="off" placeholder="" aria-label="Stock location search">' +
        '<button id="ptx7-location-submit" type="button">SEARCH</button>' +
        '<button id="ptx7-location-type" class="ptx7-type-btn" type="button">\u2328 TYPE LOCATION</button>' +
      '</div>' +
      '<div id="ptx7-location-actions">' +
        '<button type="button" data-location-control="Add Product">ADD PRODUCT</button>' +
        '<button type="button" data-location-control="Add Stock Location">ADD STOCK LOCATION</button>' +
        '<button type="button" id="ptx7-full-location">FULL LOCATION MANAGEMENT</button>' +
      '</div>' +
      '<div id="ptx7-location-results"></div>' +
    '</main>';
  document.body.appendChild(locationRoot);

  var inventoryInput = inventoryRoot.querySelector('#ptx7-inventory-input');
  var inventoryMessage = inventoryRoot.querySelector('#ptx7-inventory-message');
  var detailSelect = inventoryRoot.querySelector('#ptx7-inventory-detail');
  var results = inventoryRoot.querySelector('#ptx7-inventory-results');
  var locationInput = locationRoot.querySelector('#ptx7-location-input');
  var locationResults = locationRoot.querySelector('#ptx7-location-results');

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

  var retryTimer = null;
  function queueRetry(kind, value, scannerInput) {
    clearTimeout(retryTimer);
    var target = kind === 'inventory' ? results : locationResults;
    target.innerHTML = '<div class="ptx7-card"><strong>Waiting for PIMS\u2026 ' + esc(value) + ' will search automatically.</strong></div>';
    var started = Date.now();
    (function attempt() {
      retryTimer = setTimeout(function () {
        var ok = kind === 'inventory' ? submitInventorySearchNow(value, scannerInput) : submitLocationSearchNow(value, scannerInput);
        if (ok) return;
        if (Date.now() - started < 8000) attempt();
        else showMessage('PIMS did not load in time. Scan again.', kind === 'inventory');
      }, 250);
    })();
  }
  function submitInventorySearchNow(value, scannerInput) {
    var input = nativeInventoryField(), submit = nearbySubmit(input);
    if (!input || !submit || submit.disabled || submit.getAttribute('aria-disabled') === 'true') return false;
    inventorySearchBusy = false;
    return submitInventorySearch(value, scannerInput) !== false;
  }
  function submitLocationSearchNow(value, scannerInput) {
    var input = locationScanField(), submit = nearbySubmit(input);
    if (!input || !submit || submit.disabled || submit.getAttribute('aria-disabled') === 'true') return false;
    locationSearchBusy = false;
    return submitLocationSearch(value, scannerInput) !== false;
  }

  // ---------------------------------------------------------------------------
  // Location Buddy: after each Inventory scan, read the product's locations
  // aloud (e.g. MANFW0101-F-11 -> "one zero one, F, eleven") so stock can be
  // put away with a finger scanner without looking at the screen.
  // ---------------------------------------------------------------------------
  var BUDDY_ON = 'ptx7_buddy_on', BUDDY_RATE = 'ptx7_buddy_rate', BUDDY_VOICE = 'ptx7_buddy_voice', BUDDY_REPEAT = 'ptx7_buddy_repeat';
  var DIGITS = ['zero','one','two','three','four','five','six','seven','eight','nine'];
  var buddyPendingAt = 0, buddyNdcAtSubmit = '', buddyTimers = [];
  function pref(key, fallback) { try { var v = localStorage.getItem(key); return v == null ? fallback : v; } catch (_) { return fallback; } }
  function setPref(key, value) { try { localStorage.setItem(key, value); } catch (_) {} }
  function buddyOn() { return pref(BUDDY_ON, 'true') !== 'false'; }
  function digitsAsWords(d) { return String(d).split('').map(function (c) { return DIGITS[Number(c)]; }).join(' '); }
  function spokenCode(code) {
    return String(code).toUpperCase().split('-').map(function (part, i) {
      if (i === 0) {
        var d = (part.match(/(\d+)$/) || [])[1];
        return d ? digitsAsWords(d.replace(/^0+(?=\d{3})/, '')) : part.split('').join(' ');
      }
      if (/^\d+$/.test(part)) return String(Number(part));
      return part.split('').join(' ');
    }).join(', ');
  }
  function buddyMessage(codes) {
    if (!codes.length) return 'No location assigned.';
    var spoken = codes.map(spokenCode);
    var text = codes.length === 1 ? 'Location. ' + spoken[0] + '.' : codes.length + ' locations. ' + spoken.join('. Then, ') + '.';
    return pref(BUDDY_REPEAT, '1') === '2' ? text + ' Again. ' + text : text;
  }
  function buddySpeak(text) {
    var rate = Number(pref(BUDDY_RATE, '1')) || 1;
    try {
      if (window.PTX7Host && window.PTX7Host.speak && (!window.PTX7Host.ttsAvailable || window.PTX7Host.ttsAvailable())) {
        window.PTX7Host.speak(text, rate, pref(BUDDY_VOICE, ''));
        return;
      }
    } catch (_) {}
    try {
      if (!window.speechSynthesis) return;
      window.speechSynthesis.cancel();
      var u = new SpeechSynthesisUtterance(text); u.rate = rate; u.volume = 1; u.lang = 'en-US';
      window.speechSynthesis.speak(u);
    } catch (_) {}
  }
  function nativeNdc() { var m = nativeBodyText().match(/\bNDC\s*-?\s*(\d{9,14})\b/i); return m ? m[1] : ''; }
  function nativeLocationCodes() {
    var t = findTable([/Subarea/i, /Location/i, /Quantity/i]);
    var found = {}, list = [];
    (String(t ? t.innerText : '').toUpperCase().match(LOCATION_CODE) || []).forEach(function (c) { if (!found[c]) { found[c] = true; list.push(c); } });
    return list;
  }
  function armBuddy() {
    buddyTimers.forEach(clearTimeout); buddyTimers = [];
    if (!buddyOn()) return;
    buddyPendingAt = Date.now(); buddyNdcAtSubmit = nativeNdc();
    [500, 900, 1400, 2000, 2800, 3800].forEach(function (ms) { buddyTimers.push(setTimeout(buddyCheck, ms)); });
  }
  function buddyCheck() {
    if (!buddyPendingAt) return;
    var age = Date.now() - buddyPendingAt, ndc = nativeNdc();
    var fresh = ndc && (ndc !== buddyNdcAtSubmit || age > 1300);
    if (!fresh && age < 3700) return;
    var codes = fresh ? nativeLocationCodes() : [];
    if (!codes.length && age < 2700) return;
    buddyPendingAt = 0; buddyTimers.forEach(clearTimeout); buddyTimers = [];
    var msg = fresh ? buddyMessage(codes) : 'Product not found.';
    var last = inventoryRoot.querySelector('#ptx7-buddy-last');
    if (last) last.textContent = codes.length ? '\uD83D\uDD0A ' + codes.join('  \u00b7  ') : '\uD83D\uDD0A ' + msg;
    buddySpeak(msg);
  }

  var buddySheet = document.createElement('div'); buddySheet.id = 'ptx7-buddy-sheet';
  inventoryRoot.appendChild(buddySheet);
  function buddyVoices() {
    var list = [];
    try { if (window.PTX7Host && window.PTX7Host.ttsVoices) list = JSON.parse(window.PTX7Host.ttsVoices() || '[]'); } catch (_) {}
    if (!list.length && window.speechSynthesis) {
      list = window.speechSynthesis.getVoices().filter(function (v) { return /^en/i.test(v.lang || ''); }).map(function (v) { return {name: v.name, locale: v.lang}; });
    }
    return list;
  }
  function voiceLabel(v) {
    var n = String(v.name || '');
    var accent = /en[-_]US/i.test(v.locale) ? 'US' : /en[-_]GB/i.test(v.locale) ? 'UK' : /en[-_]AU/i.test(v.locale) ? 'Australia' : /en[-_]IN/i.test(v.locale) ? 'India' : String(v.locale || '');
    var tag = (n.match(/-(x-[a-z0-9]+)-/i) || [])[1] || '';
    return accent + (tag ? ' \u00b7 voice ' + tag.replace('x-', '').toUpperCase() : (n ? ' \u00b7 ' + n : ''));
  }
  function tiles(options, current, key) {
    return options.map(function (o) {
      return '<button type="button" class="ptx7-buddy-tile' + (String(o[0]) === String(current) ? ' sel' : '') + '" data-pref="' + key + '" data-val="' + esc(o[0]) + '">' + esc(o[1]) + '</button>';
    }).join('');
  }
  function openBuddySheet() {
    var voices = buddyVoices(), cur = pref(BUDDY_VOICE, '');
    buddySheet.innerHTML = '<div class="box"><h2>LOCATION BUDDY</h2>' +
      '<div class="lbl">SPEED</div><div class="ptx7-buddy-tiles">' + tiles([['0.8','SLOW'],['1','NORMAL'],['1.25','FAST'],['1.5','FASTER']], pref(BUDDY_RATE, '1'), BUDDY_RATE) + '</div>' +
      '<div class="lbl">REPEAT</div><div class="ptx7-buddy-tiles two">' + tiles([['1','ONCE'],['2','TWICE']], pref(BUDDY_REPEAT, '1'), BUDDY_REPEAT) + '</div>' +
      '<div class="lbl">VOICE</div><select class="ptx7-buddy-voice"><option value="">Device default</option>' +
      voices.map(function (v) { return '<option value="' + esc(v.name) + '"' + (v.name === cur ? ' selected' : '') + '>' + esc(voiceLabel(v)) + '</option>'; }).join('') + '</select>' +
      '<div class="ptx7-adj-nav"><button type="button" class="ptx7-adj-btn ghost" data-buddy="test">\uD83D\uDD0A TEST</button><button type="button" class="ptx7-adj-btn primary" data-buddy="done">DONE</button></div>' +
      '<div class="lbl" style="text-align:center">Turn up media volume for loud playback.</div></div>';
    buddySheet.style.display = 'flex';
  }
  buddySheet.addEventListener('click', function (e) {
    var t = e.target.closest && e.target.closest('button'); if (!t) return;
    if (t.getAttribute('data-pref')) { setPref(t.getAttribute('data-pref'), t.getAttribute('data-val')); openBuddySheet(); buddySpeak(buddyMessage(['MANFW0101-F-11'])); return; }
    if (t.getAttribute('data-buddy') === 'test') buddySpeak(buddyMessage(['MANFW0101-F-11']));
    if (t.getAttribute('data-buddy') === 'done') { buddySheet.style.display = 'none'; setTimeout(function () { try { inventoryInput.focus({preventScroll: true}); } catch (_) {} }, 50); }
  });
  buddySheet.addEventListener('change', function (e) {
    if (e.target.classList.contains('ptx7-buddy-voice')) { setPref(BUDDY_VOICE, e.target.value); buddySpeak(buddyMessage(['MANFW0101-F-11'])); }
  });
  function paintBuddyToggle() {
    var b = inventoryRoot.querySelector('#ptx7-buddy-toggle'); if (!b) return;
    var on = buddyOn(); b.className = 'ptx7-buddy-btn ' + (on ? 'on' : 'off');
    b.textContent = on ? '\uD83D\uDD0A LOCATION BUDDY ON' : '\uD83D\uDD07 LOCATION BUDDY OFF';
  }
  inventoryRoot.querySelector('#ptx7-buddy-toggle').addEventListener('click', function () {
    setPref(BUDDY_ON, buddyOn() ? 'false' : 'true'); paintBuddyToggle();
    if (buddyOn()) buddySpeak('Location buddy on.'); else { try { window.PTX7Host && window.PTX7Host.stopSpeaking && window.PTX7Host.stopSpeaking(); } catch (_) {} }
    setTimeout(function () { try { inventoryInput.focus({preventScroll: true}); } catch (_) {} }, 50);
  });
  inventoryRoot.querySelector('#ptx7-buddy-config').addEventListener('click', openBuddySheet);
  paintBuddyToggle();

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
      // PIMS is still rendering (common on the first scan). Hold the scan and retry.
      queueRetry('inventory', searchValue, scannerInput);
      return false;
    }
    inventorySearchBusy = true;
    inventoryInput.value = searchValue;
    setNativeValue(input, searchValue);
    lastSubmitted = searchValue;
    lastSubmittedAt = Date.now();
    lastRenderSignature = '';
    transactionWakeRequested = false;
    wokenSections = {};
    results.innerHTML = '<div class="ptx7-card"><strong>Searching PIMS for ' + esc(searchValue) + '\u2026</strong></div>';
    armBuddy();
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

  function submitLocationSearch(raw, scannerInput) {
    if (locationSearchBusy) return false;
    var value=String(raw==null?'':raw).trim();
    if (value.length<4) { showMessage('Scan or enter a complete stock location.', false); return false; }
    var input=locationScanField(),submit=nearbySubmit(input);
    if(!input||!submit||submit.disabled||submit.getAttribute('aria-disabled')==='true'){
      queueRetry('locations', value, scannerInput);return false;
    }
    locationSearchBusy=true;setNativeValue(input,value);lastSubmitted=value;lastSubmittedAt=Date.now();lastLocationSignature='';
    locationResults.innerHTML='<div class="ptx7-card"><strong>Loading location '+esc(value)+'\u2026</strong></div>';
    submit.click();
    setTimeout(function(){locationInput.value='';try{locationInput.focus({preventScroll:true});}catch(_){}},100);
    setTimeout(function(){locationSearchBusy=false;},700);
    scheduleLocationRender(250);scheduleLocationRender(900);
    return true;
  }
  var locationFirstAt=0,locationEventCount=0,locationCaptureTimer=null;
  locationInput.addEventListener('input',function(){
    if(!locationFirstAt)locationFirstAt=performance.now();locationEventCount++;clearTimeout(locationCaptureTimer);
    locationCaptureTimer=setTimeout(function(){var value=String(locationInput.value||'').trim(),elapsed=performance.now()-locationFirstAt,events=locationEventCount;locationFirstAt=0;locationEventCount=0;if(value.length>=4&&(events===1||elapsed<value.length*45))submitLocationSearch(value,true);},180);
  });
  locationInput.addEventListener('keydown',function(event){
    if(event.key!=='Enter'&&event.key!=='Tab')return;event.preventDefault();clearTimeout(locationCaptureTimer);locationFirstAt=0;locationEventCount=0;submitLocationSearch(locationInput.value,true);
  });
  locationRoot.querySelector('#ptx7-location-submit').addEventListener('click',function(){submitLocationSearch(locationInput.value,false);});

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
        if (linkMode === 'locations') {
          var codes = String(cell.innerText || '').toUpperCase().match(LOCATION_CODE);
          if (codes && codes.length) {
            return '<td>' + codes.map(function (code) {
              return '<button type="button" class="ptx7-loc-link" data-goto-location="' + esc(code) + '">' + esc(code) + ' \u203a</button>';
            }).join('') + '</td>';
          }
        }
        var link = linkMode === true && cell.querySelector('a[href],button,[role="button"]');
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
    // Preserve line breaks so rows stay readable when no table is detectable.
    return section ? String(section.innerText || '').replace(/[ \t]+/g,' ').replace(/\n{3,}/g,'\n\n').trim() : '';
  }
  function wakeTransactionHistory() {
    if (transactionWakeRequested) return;
    var section=sectionContainer(/Transaction History/i);
    if (!section) return;
    transactionWakeRequested=true;
    try { section.scrollIntoView({block:'center'}); } catch (_) {}
    setTimeout(function(){lastRenderSignature='';renderInventory();},500);
  }

  var removeActions=[], pendingRemove=null;
  function nativeRemoveButton(row){
    var buttons=[].slice.call(row.querySelectorAll('button,[role="button"]')).filter(function(b){return !isToolElement(b);});
    if(!buttons.length)return null;
    var labeled=buttons.find(function(b){return /remove|delete|disassociate|minus/i.test(normalize(b.innerText||b.getAttribute('aria-label')||b.getAttribute('title')||b.getAttribute('data-testid')));});
    return labeled||(buttons.length===1?buttons[0]:null);
  }
  var removeConfirm=document.createElement('div');
  removeConfirm.id='ptx7-remove-confirm';
  removeConfirm.innerHTML='<div class="box"><h2>REMOVE?</h2><div id="ptx7-remove-text" style="white-space:pre-wrap;line-height:1.45"></div>'+
    '<div class="row"><button type="button" id="ptx7-remove-cancel" style="background:#e5e9ec;color:#172b3a">CANCEL</button>'+
    '<button type="button" id="ptx7-remove-yes" style="background:#b42318;color:#fff">REMOVE</button></div></div>';
  document.body.appendChild(removeConfirm);
  function closeRemoveConfirm(){pendingRemove=null;removeConfirm.style.display='none';setTimeout(function(){try{locationInput.focus({preventScroll:true});}catch(_){}},50);}
  removeConfirm.querySelector('#ptx7-remove-cancel').addEventListener('click',closeRemoveConfirm);
  removeConfirm.querySelector('#ptx7-remove-yes').addEventListener('click',function(){
    var action=pendingRemove;closeRemoveConfirm();
    if(!action||!document.documentElement.contains(action.button)){showMessage('That product is no longer listed. Scan the location again.',false);return;}
    // Confirmed here; let the original PIMS control run without a second prompt.
    action.button.dataset.ptx7RemovalConfirmed='true';
    action.button.click();
    setTimeout(function(){delete action.button.dataset.ptx7RemovalConfirmed;},1000);
    // If PIMS opens its own dialog, show it and return when it closes.
    setTimeout(function(){
      if(nativeElements('[role="dialog"],[aria-modal="true"]').some(visible)){
        locationsSimple=false;nativeActionActive=true;nativeDialogSeen=true;nativeActionStartedAt=Date.now();
        document.documentElement.classList.add('ptx7-native-action');locationRoot.style.display='none';
      }else{lastLocationSignature='';scheduleLocationRender(400);}
    },350);
  });
  locationResults.addEventListener('click',function(event){
    var b=event.target.closest&&event.target.closest('[data-remove-action]');if(!b)return;
    var action=removeActions[Number(b.getAttribute('data-remove-action'))];if(!action)return;
    pendingRemove=action;
    removeConfirm.querySelector('#ptx7-remove-text').textContent='Product ID: '+action.details.productId+'\nProduct: '+action.details.productName+'\nQuantity: '+action.details.quantity+'\n\nRemove this product from the current location?';
    removeConfirm.style.display='flex';
  });

  function renderLocation() {
    if(currentMode()!=='locations'||!locationsSimple)return;
    var text=nativeBodyText();
    var headings=nativeHeadings().filter(function(h){return !/Pharmacy Inventory Management Console|Stock Locations?$/i.test(h);});
    var code=(text.match(/\b[A-Z]{2,}[A-Z0-9]*\d{2,}(?:-[A-Z0-9]+)+\b/)||[''])[0];
    var grids=nativeElements('table,[role="table"],[role="grid"]');
    var details=nativeElements('dl,[data-testid*="detail"],[data-testid*="owner"]').map(function(el){return normalize(el.innerText);}).filter(Boolean).slice(0,6);
    var signature=[code,headings.join('|'),details.join('|')].concat(grids.map(function(g){return normalize(g.innerText);})).join('||');
    if(signature===lastLocationSignature)return;lastLocationSignature=signature;
    if(!code&&!grids.length&&!details.length){locationResults.innerHTML='';return;}
    var html='<section class="ptx7-card"><h2>LOCATION DETAILS</h2><div class="ptx7-product">'+esc(code||headings[0]||'Stock location')+'</div>';
    if(details.length)html+='<div class="ptx7-native-copy">'+esc(details.join('\n\n'))+'</div>';html+='</section>';
    grids.forEach(function(grid,index){html+='<section class="ptx7-card"><h2>'+(index===0?'PRODUCTS / OWNERS / QUANTITIES':'ADDITIONAL DETAILS')+'</h2>'+tableHtml(grid,false)+'</section>';});
    // Products that PIMS allows removing from this location.
    removeActions=[];
    var removable=[];
    grids.forEach(function(grid){
      [].slice.call(grid.querySelectorAll('tbody tr,[role="row"]')).forEach(function(row){
        var btn=nativeRemoveButton(row);if(!btn)return;
        var details=productRemovalDetails(btn);if(!details)return;
        removable.push('<tr><td>'+esc(details.productId)+'</td><td>'+esc(details.productName)+'</td><td>'+esc(details.quantity)+'</td><td><button type="button" class="ptx7-remove-btn" data-remove-action="'+(removeActions.push({button:btn,details:details})-1)+'">REMOVE</button></td></tr>');
      });
    });
    if(removable.length)html+='<section class="ptx7-card"><h2>REMOVE PRODUCT FROM LOCATION</h2><div class="ptx7-table-wrap"><table class="ptx7-table"><thead><tr><th>Product ID</th><th>Product</th><th>Qty</th><th></th></tr></thead><tbody>'+removable.join('')+'</tbody></table></div></section>';
    locationResults.innerHTML=html;
  }
  function scheduleLocationRender(delay){clearTimeout(locationRenderTimer);locationRenderTimer=setTimeout(renderLocation,delay||100);}

  // ---- Section-based readers for Incoming Purchases / Transaction History ----
  // PIMS tables can render a header-only sticky copy; read every data row in
  // the section instead of trusting the first matching <table>.
  var txState = {start:'', end:''};
  var SECTION_HEADINGS = /Incoming Purchases|Transaction History|Related Dispensable/i;
  function sectionRoot(headingPattern) {
    var headings = nativeElements('h1,h2,h3,h4,[role="heading"]');
    var heading = headings.find(function (el) { return headingPattern.test(normalize(el.innerText)); });
    if (!heading) return null;
    var others = headings.filter(function (h) { return h !== heading && !heading.contains(h) && !h.contains(heading) && SECTION_HEADINGS.test(normalize(h.innerText)); });
    var best = heading.parentElement, node = best;
    for (var i = 0; node && node !== document.body && i < 8; i++, node = node.parentElement) {
      // Stop before an ancestor that also holds a different section.
      if (others.some(function (h) { return node.contains(h); })) break;
      best = node;
      if (node.querySelector('tbody tr td,[role="row"] [role="cell"],[role="row"] [role="gridcell"]')) return node;
    }
    return best;
  }
  function readSectionGrid(section) {
    if (!section) return {headers:[], rows:[]};
    var headers = [];
    [].slice.call(section.querySelectorAll('table,[role="table"],[role="grid"]')).some(function (t) {
      var h = [].slice.call(t.querySelectorAll('thead th,[role="columnheader"]')).map(function (c) { return normalize(c.innerText); });
      if (h.filter(Boolean).length) { headers = h; return true; } return false;
    });
    var seen = {}, rows = [];
    [].slice.call(section.querySelectorAll('tbody tr,[role="row"]')).forEach(function (r) {
      if (r.querySelector('th,[role="columnheader"]') && !r.querySelector('td,[role="cell"],[role="gridcell"]')) return;
      var cells = [].slice.call(r.querySelectorAll(':scope > td,:scope > [role="cell"],:scope > [role="gridcell"]'));
      if (!cells.length) return;
      var texts = cells.map(function (c) { return normalize(c.innerText || c.getAttribute('aria-label') || ''); });
      var key = texts.join('|'); if (!key.replace(/\|/g, '') || seen[key]) return; seen[key] = true;
      rows.push({cells:cells, texts:texts});
    });
    return {headers:headers, rows:rows};
  }
  function col(headers, pattern, fallback) {
    var i = headers.findIndex(function (h) { return pattern.test(h); });
    return i >= 0 ? i : fallback;
  }
  function yesNo(cell, text) {
    var t = String(text || '');
    if (!t && cell) { var icon = cell.querySelector('[aria-label],[title],svg'); t = icon ? (icon.getAttribute('aria-label') || icon.getAttribute('title') || '') : ''; }
    if (/\b(yes|true|receivable|open|success)\b/i.test(t)) return 'YES';
    if (/\b(no|false|closed|error|not)\b/i.test(t)) return 'NO';
    return t || '\u2014';
  }
  var wokenSections = {};
  function wakeSection(pattern) {
    if (wokenSections[pattern.source]) return;
    var sec = sectionRoot(pattern); if (!sec) return;
    wokenSections[pattern.source] = true;
    try { sec.scrollIntoView({block:'center'}); } catch (_) {}
  }
  function incomingHtml() {
    var grid = readSectionGrid(sectionRoot(/Incoming Purchases/i)), h = grid.headers;
    if (!grid.rows.length) return '<div class="ptx7-empty">No incoming purchase orders returned by PIMS.</div>';
    var iPo = col(h, /PO Number/i, 1), iPur = col(h, /Purchased/i, 2), iRec = col(h, /Received/i, 3), iAble = col(h, /Receivable/i, 4);
    return '<div class="ptx7-scroll">' + grid.rows.map(function (r) {
      var poCell = r.cells[iPo], link = poCell && poCell.querySelector('a[href],button,[role="button"],[role="link"]');
      var idx = poActions.push({href: link && link.getAttribute && link.getAttribute('href'), element: link || poCell}) - 1;
      var able = yesNo(r.cells[iAble], r.texts[iAble]);
      return '<div class="ptx7-po-card"><button type="button" class="po" data-po-action="' + idx + '">PO ' + esc(r.texts[iPo] || '\u2014') + ' \u203a</button>' +
        '<div><div class="k">PURCHASED</div><div class="v">' + esc(r.texts[iPur] || '\u2014') + '</div></div>' +
        '<div><div class="k">RECEIVED</div><div class="v">' + esc(r.texts[iRec] || '\u2014') + '</div></div>' +
        '<div><div class="k">RECEIVABLE</div><div class="v ' + (able === 'YES' ? 'ptx7-yes' : able === 'NO' ? 'ptx7-no' : '') + '">' + esc(able) + '</div></div></div>';
    }).join('') + '</div>';
  }
  function nativeDateInputs() {
    var sec = sectionRoot(/Transaction History/i); if (!sec) return [];
    return [].slice.call(sec.querySelectorAll('input')).filter(function (i) {
      var l = (i.getAttribute('placeholder') || '') + ' ' + (i.getAttribute('aria-label') || '') + ' ' + (i.value || '');
      return /date|\d{1,2}\/\d{1,2}\/\d{2,4}|YYYY|MM/i.test(l);
    });
  }
  function toIso(v) { var m = String(v || '').match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/); return m ? m[3] + '-' + ('0' + m[1]).slice(-2) + '-' + ('0' + m[2]).slice(-2) : ''; }
  function fromIso(v) { var m = String(v || '').match(/(\d{4})-(\d{2})-(\d{2})/); return m ? m[2] + '/' + m[3] + '/' + m[1] : ''; }
  function niceDate(iso) { var m = String(iso || '').match(/(\d{4})-(\d{2})-(\d{2})/); if (!m) return 'SELECT'; return ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'][Number(m[2]) - 1] + ' ' + Number(m[3]) + ', ' + m[1]; }
  function applyDate(which, iso) {
    var inputs = nativeDateInputs(), target = inputs[which === 'start' ? 0 : 1];
    if (!target) { showMessage('PIMS date range is not available yet.', true); return; }
    txState[which] = iso;
    try { target.focus(); } catch (_) {}
    setNativeValue(target, fromIso(iso));
    target.dispatchEvent(new KeyboardEvent('keydown', {key:'Enter', bubbles:true}));
    try { target.blur(); } catch (_) {}
    // Re-query PIMS with the new range (native Refresh stays hidden from users).
    setTimeout(function () {
      var sec = sectionRoot(/Transaction History/i);
      var refresh = sec && [].slice.call(sec.querySelectorAll('button')).find(function (b) { return /^refresh$/i.test(normalize(b.innerText || b.getAttribute('aria-label'))); });
      if (refresh) refresh.click();
      lastRenderSignature = ''; scheduleRender(700);
      setTimeout(function () { try { inventoryInput.focus({preventScroll:true}); } catch (_) {} }, 400);
    }, 150);
  }
  function transactionsHtml() {
    var inputs = nativeDateInputs();
    var start = txState.start || toIso(inputs[0] && inputs[0].value), end = txState.end || toIso(inputs[1] && inputs[1].value);
    var html = '<div class="ptx7-dates">' +
      '<label class="ptx7-date-btn"><small>START DATE</small>' + esc(niceDate(start)) + '<input type="date" data-tx-date="start" value="' + esc(start) + '"></label>' +
      '<label class="ptx7-date-btn"><small>END DATE</small>' + esc(niceDate(end)) + '<input type="date" data-tx-date="end" value="' + esc(end) + '"></label></div>';
    var grid = readSectionGrid(sectionRoot(/Transaction History/i)), h = grid.headers;
    if (!grid.rows.length) return html + '<div class="ptx7-empty">No transactions in this date range.</div>';
    var iDate = col(h, /^Date/i, 0), iType = col(h, /Type/i, 1), iQty = col(h, /^Quantity/i, 2), iVal = col(h, /^Value/i, 3), iOn = col(h, /Onhand/i, 4), iUser = col(h, /User/i, 5), iRea = col(h, /Reason/i, 6);
    return html + '<div class="ptx7-scroll">' + grid.rows.map(function (r) {
      var q = r.texts[iQty] || '', cls = /^-/.test(q) ? 'neg' : (q ? 'pos' : '');
      return '<div class="ptx7-tx"><div class="top"><span>' + esc(r.texts[iType] || '') + '</span><span class="' + cls + '">' + esc(q) + '</span></div>' +
        '<div>' + esc(r.texts[iDate] || '') + '</div>' +
        '<div>On-hand after: <strong>' + esc(r.texts[iOn] || '\u2014') + '</strong> \u00b7 ' + esc(r.texts[iVal] || '') + '</div>' +
        '<div>' + esc(r.texts[iUser] || '') + (r.texts[iRea] ? ' \u00b7 ' + esc(r.texts[iRea]) : '') + '</div></div>';
    }).join('') + '</div>';
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
    if (selection === 'incoming' || selection === 'all') wakeSection(/Incoming Purchases/i);
    var incomingGrid = readSectionGrid(sectionRoot(/Incoming Purchases/i));
    var txGrid = readSectionGrid(sectionRoot(/Transaction History/i));
    var dateInputs = nativeDateInputs();
    var signature = [selection, product, ndc, onhandMatch && onhandMatch[1], valueMatch && valueMatch[1], relatedMatch && relatedMatch[1],
      locationsTable && normalize(locationsTable.innerText),
      incomingGrid.rows.map(function (r) { return r.texts.join(','); }).join(';'),
      txGrid.rows.map(function (r) { return r.texts.join(','); }).join(';'),
      dateInputs.map(function (i) { return i.value; }).join('~'), txState.start, txState.end].join('|');
    if (signature === lastRenderSignature) return;
    lastRenderSignature = signature;
    poActions = [];

    if (!product && !ndc && !onhandMatch) {
      results.innerHTML = '';
      return;
    }
    var overview = '<section class="ptx7-card"><div class="ptx7-product">' + esc(product || 'Inventory product') + '</div>' +
      '<div class="ptx7-ndc">NDC: ' + esc(ndc || 'Not returned') + '</div>' +
      '<div class="ptx7-metrics"><div class="ptx7-metric">On-hand: ' + esc(onhandMatch ? onhandMatch[1] : 'Not returned') + '</div>' +
      '<div class="ptx7-metric">Value: ' + esc(valueMatch ? valueMatch[1] : 'Not returned') + '</div></div>' +
      '<div style="margin-top:13px;font-weight:800">Related products: ' + esc(relatedMatch ? relatedMatch[1] : 'Not returned') + '</div></section>';
    var html = '';
    if (selection === 'overview' || selection === 'all') html += overview;
    if (selection === 'locations' || selection === 'all') html += '<section class="ptx7-card"><h2>LOCATIONS <span style="font-size:26px;font-weight:700">(tap to manage)</span></h2>' + tableHtml(locationsTable, 'locations') + '</section>';
    if (selection === 'incoming' || selection === 'all') html += '<section class="ptx7-card"><h2>INCOMING POs <span style="font-size:26px;font-weight:700">(tap PO to open)</span></h2>' + incomingHtml() + '</section>';
    if (selection === 'transactions' || selection === 'all') html += '<section class="ptx7-card"><h2>TRANSACTION HISTORY</h2>' + transactionsHtml() + '</section>';
    results.innerHTML = html || overview;
  }

  function scheduleRender(delay) {
    clearTimeout(renderTimer);
    renderTimer = setTimeout(renderInventory, delay || 100);
  }
  detailSelect.addEventListener('change', function () { transactionWakeRequested=false; wokenSections={}; lastRenderSignature = ''; renderInventory(); });
  results.addEventListener('change', function (event) {
    var d = event.target && event.target.getAttribute && event.target.getAttribute('data-tx-date');
    if (d && event.target.value) applyDate(d, event.target.value);
  });
  // Open the native Android date wheel/calendar on tap.
  results.addEventListener('click', function (event) {
    var input = event.target && event.target.matches && event.target.matches('input[data-tx-date]') ? event.target : null;
    if (input && input.showPicker) { try { input.showPicker(); } catch (_) {} }
  });
  results.addEventListener('click', function (event) {
    var locLink = event.target.closest && event.target.closest('[data-goto-location]');
    if (locLink) {
      var code = locLink.getAttribute('data-goto-location');
      try { sessionStorage.setItem(GOTO_KEY, JSON.stringify({code: code, at: Date.now()})); } catch (_) {}
      locLink.textContent = 'OPENING ' + code + '\u2026';
      location.href = LOCATIONS_URL;
      return;
    }
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
  // ---------------------------------------------------------------------------
  // Adjust Inventory: large PIMS Mobile style skin over the native 3-step
  // "Perform Adjustment" wizard. Every choice is forwarded to the original PIMS
  // control; PIMS remains the validator and the submitter.
  // ---------------------------------------------------------------------------
  var adjustActive = false, adjustSignature = '', adjustDialog = null;
  var KNOWN_AREAS = ['Forward', 'External Automation Vial Fill', 'In-Transit'];
  var adjustRoot = document.createElement('section');
  adjustRoot.id = 'ptx7-adjust-root';
  document.body.appendChild(adjustRoot);

  function adjustNativeDialog() {
    return nativeElements('[role="dialog"],[aria-modal="true"]').filter(visible).find(function (d) {
      return /Perform Adjustment|Adjust/i.test(normalize(d.innerText).slice(0, 400));
    }) || null;
  }
  function inDialog(selector) {
    return adjustDialog ? [].slice.call(adjustDialog.querySelectorAll(selector)).filter(function (e) { return !isToolElement(e); }) : [];
  }
  function dialogButton(pattern) {
    return inDialog('button,[role="button"],a').filter(visible).find(function (b) {
      return pattern.test(normalize(b.innerText || b.getAttribute('aria-label') || ''));
    }) || null;
  }
  function labelFor(el) {
    var id = el.id, l = id && adjustDialog.querySelector('label[for="' + id + '"]');
    var wrap = el.closest('label');
    return normalize((l && l.innerText) || (wrap && wrap.innerText) || el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.value || '');
  }
  function setTextValue(el, value) {
    var proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    var d = Object.getOwnPropertyDescriptor(proto, 'value');
    if (d && d.set) d.set.call(el, value); else el.value = value;
    el.dispatchEvent(new Event('input', {bubbles: true}));
    el.dispatchEvent(new Event('change', {bubbles: true}));
  }
  function pressEnter(el) {
    ['keydown', 'keypress', 'keyup'].forEach(function (t) {
      el.dispatchEvent(new KeyboardEvent(t, {key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true}));
    });
  }
  // Native select: either <select> or a Cloudscape-style listbox trigger.
  function nativeSelects() {
    var plain = inDialog('select').filter(visible).map(function (s) { return {kind: 'select', el: s}; });
    var custom = inDialog('[aria-haspopup="listbox"]').filter(visible).filter(function (b) {
      return !/^(back|next|cancel|close|adjust inventory)$/i.test(normalize(b.innerText));
    }).map(function (b) { return {kind: 'listbox', el: b}; });
    return plain.concat(custom);
  }
  function selectValueText(s) {
    if (s.kind === 'select') { var o = s.el.options[s.el.selectedIndex]; return o ? normalize(o.text) : ''; }
    return normalize(s.el.innerText || s.el.getAttribute('aria-label') || '');
  }
  var optionCache = {};
  function readListboxOptions(s, done) {
    var key = labelFor(s.el) || 'select';
    if (optionCache[key] && optionCache[key].length) { done(optionCache[key]); return; }
    var finish = function (opts) { if (opts.length) optionCache[key] = opts; done(opts); };
    if (s.kind === 'select') { finish([].slice.call(s.el.options).map(function (o) { return normalize(o.text); }).filter(Boolean)); return; }
    s.el.click();
    setTimeout(function () {
      var opts = nativeElements('[role="option"]').filter(visible).map(function (o) { return normalize(o.innerText); }).filter(Boolean);
      s.el.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape', bubbles: true}));
      try { document.activeElement && document.activeElement.blur(); } catch (_) {}
      finish(opts);
    }, 180);
  }
  function chooseNativeOption(s, text) {
    if (s.kind === 'select') {
      var opt = [].slice.call(s.el.options).find(function (o) { return normalize(o.text) === text; });
      if (opt) { s.el.value = opt.value; s.el.dispatchEvent(new Event('change', {bubbles: true})); }
      return;
    }
    s.el.click();
    setTimeout(function () {
      var o = nativeElements('[role="option"]').filter(visible).find(function (x) { return normalize(x.innerText) === text; });
      if (o) o.click(); else s.el.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape', bubbles: true}));
      adjustSignature = ''; setTimeout(renderAdjust, 250);
    }, 180);
  }

  // Scroll-snap wheel picker. onPick(value) fires when the wheel settles.
  function buildWheel(values, selected, onPick) {
    var wrap = document.createElement('div'); wrap.className = 'ptx7-wheel';
    var list = document.createElement('div'); list.className = 'ptx7-wheel-list';
    values.forEach(function (v) { var i = document.createElement('div'); i.className = 'ptx7-wheel-item'; i.textContent = v; list.appendChild(i); });
    wrap.innerHTML = '<div class="ptx7-wheel-band"></div>'; wrap.appendChild(list);
    var item = 92, index = Math.max(0, values.indexOf(selected)), timer = null;
    function mark() { [].slice.call(list.children).forEach(function (c, n) { c.classList.toggle('sel', n === index); }); }
    setTimeout(function () { list.scrollTop = index * item; mark(); }, 0);
    list.addEventListener('scroll', function () {
      clearTimeout(timer);
      timer = setTimeout(function () {
        var n = Math.max(0, Math.min(values.length - 1, Math.round(list.scrollTop / item)));
        if (n !== index) { index = n; mark(); onPick(values[n]); }
      }, 140);
    });
    list.addEventListener('click', function (e) {
      var n = [].indexOf.call(list.children, e.target); if (n < 0) return;
      list.scrollTo({top: n * item, behavior: 'smooth'});
    });
    return wrap;
  }
  function adjustButton(label, cls, handler) {
    var b = document.createElement('button'); b.type = 'button'; b.className = 'ptx7-adj-btn ' + (cls || ''); b.textContent = label;
    b.addEventListener('click', handler); return b;
  }
  function forward(pattern) {
    return function () { var b = dialogButton(pattern); if (b) { b.click(); adjustSignature = ''; setTimeout(renderAdjust, 300); } else showMessage('That PIMS option is not available here.', false); };
  }

  function stepNumber() {
    var m = normalize(adjustDialog.innerText).match(/Step\s*(\d)/i);
    return m ? Number(m[1]) : 1;
  }
  function adjustHeader(body) {
    var text = String(adjustDialog.innerText || '');
    var prod = inDialog('h1,h2,h3,[role="heading"]').map(function (h) { return normalize(h.innerText); })
      .find(function (t) { return t && !/Perform Adjustment|^Step\s*\d/i.test(t); }) || '';
    var ndc = (text.match(/NDC\s*-?\s*(\d{9,14})/i) || [])[1] || '';
    var summary = (text.match(/\n\s*([A-Za-z][^\n|]{1,40}\|\s*(?:Increase|Decrease)[^\n]*)/) || [])[1] || '';
    body.insertAdjacentHTML('beforeend', '<div class="ptx7-adj-prod">' + esc(prod) + '<small>' + (ndc ? 'NDC ' + esc(ndc) : '') +
      (summary ? ' \u00b7 ' + esc(normalize(summary)) : '') + '</small></div>');
  }

  function renderStep1(body) {
    body.insertAdjacentHTML('beforeend', '<div class="ptx7-adj-title">STEP 1 \u00b7 REASON</div>');
    var tiles = document.createElement('div'); tiles.className = 'ptx7-adj-tiles';
    var radios = inDialog('input[type="radio"],[role="radio"]');
    radios.forEach(function (r) {
      var label = labelFor(r); if (!label) return;
      var on = r.checked || r.getAttribute('aria-checked') === 'true';
      var t = adjustButton(label, 'tile' + (on ? ' on' : ''), function () { r.click(); adjustSignature = ''; setTimeout(renderAdjust, 200); });
      tiles.appendChild(t);
    });
    if (radios.length) body.appendChild(tiles);
    nativeSelects().forEach(function (s) {
      var wrap = document.createElement('div');
      wrap.insertAdjacentHTML('beforeend', '<div class="ptx7-adj-label">' + esc(labelFor(s.el) || 'SELECT') + '</div>');
      body.appendChild(wrap);
      readListboxOptions(s, function (opts) {
        if (!opts.length) return;
        wrap.appendChild(buildWheel(opts, selectValueText(s), function (v) { chooseNativeOption(s, v); }));
      });
    });
    var comment = inDialog('textarea,input[type="text"]').filter(visible)[0];
    var otherChosen = /\bother\b/i.test(radios.filter(function (r) { return r.checked || r.getAttribute('aria-checked') === 'true'; }).map(labelFor).join(' ') +
      ' ' + nativeSelects().map(selectValueText).join(' '));
    if (comment && (otherChosen || comment.tagName === 'TEXTAREA')) {
      body.insertAdjacentHTML('beforeend', '<div class="ptx7-adj-label">COMMENT' + (otherChosen ? ' <span style="color:#b42318">(REQUIRED FOR OTHER)</span>' : '') + '</div>');
      var box = document.createElement('textarea'); box.className = 'ptx7-adj-comment'; box.value = comment.value || '';
      box.addEventListener('input', function () { setTextValue(comment, box.value); });
      body.appendChild(box);
    }
    var nav = document.createElement('div'); nav.className = 'ptx7-adj-nav';
    nav.appendChild(adjustButton('CANCEL', 'ghost', function () { var c = dialogButton(/^(cancel|close)$/i) || adjustNativeDialog().querySelector('[aria-label*="close" i],[aria-label*="dismiss" i]'); if (c) c.click(); }));
    nav.appendChild(adjustButton('NEXT \u203a', 'primary', function () {
      if (otherChosen && comment && !normalize(comment.value)) { showMessage('A comment is required when the reason is Other.', false); return; }
      forward(/^next$/i)();
    }));
    body.appendChild(nav);
  }

  function renderStep2(body) {
    body.insertAdjacentHTML('beforeend', '<div class="ptx7-adj-title">STEP 2 \u00b7 STOCK LOCATIONS</div>');
    var locInputs = inDialog('input').filter(visible).filter(function (i) { return /location/i.test(labelFor(i)); });
    var areas = nativeSelects();
    locInputs.forEach(function (native, idx) {
      var card = document.createElement('div'); card.className = 'ptx7-adj-card';
      card.insertAdjacentHTML('beforeend', '<div class="ptx7-adj-label">LOCATION ' + (locInputs.length > 1 ? idx + 1 : '') + '</div>');
      var scan = document.createElement('input'); scan.type = 'text'; scan.className = 'ptx7-adj-scan'; scan.setAttribute('inputmode', 'none');
      scan.setAttribute('autocomplete', 'off'); scan.value = native.value || '';
      var timer = null;
      function push() { setTextValue(native, scan.value.trim()); pressEnter(native); }
      scan.addEventListener('input', function () { clearTimeout(timer); timer = setTimeout(push, 200); });
      scan.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); clearTimeout(timer); push(); } });
      card.appendChild(scan);
      var area = areas[idx];
      if (area) {
        card.insertAdjacentHTML('beforeend', '<div class="ptx7-adj-label">AREA</div>');
        var holder = document.createElement('div'); card.appendChild(holder);
        readListboxOptions(area, function (opts) {
          var list = opts.length ? opts : KNOWN_AREAS;
          holder.appendChild(buildWheel(list, selectValueText(area), function (v) { chooseNativeOption(area, v); }));
        });
      }
      body.appendChild(card);
      if (idx === 0) setTimeout(function () { try { scan.focus({preventScroll: true}); } catch (_) {} }, 60);
    });
    body.appendChild(adjustButton('+ ADD STOCK LOCATION', 'ghost wide', forward(/^add stock location$/i)));
    body.appendChild(adjustButton("I DON'T KNOW THE LOCATIONS", 'ghost wide', forward(/don.?t know the locations/i)));
    var nav = document.createElement('div'); nav.className = 'ptx7-adj-nav';
    nav.appendChild(adjustButton('\u2039 BACK', 'ghost', forward(/^back$/i)));
    nav.appendChild(adjustButton('NEXT \u203a', 'primary', forward(/^next$/i)));
    body.appendChild(nav);
  }

  function renderStep3(body) {
    body.insertAdjacentHTML('beforeend', '<div class="ptx7-adj-title">STEP 3 \u00b7 SCAN PACKAGES</div>');
    var total = (String(adjustDialog.innerText).match(/(Decreasing|Increasing) total inventory by[^\n]*/i) || [])[0] || '';
    if (total) body.insertAdjacentHTML('beforeend', '<div class="ptx7-adj-total">' + esc(total) + '</div>');
    body.insertAdjacentHTML('beforeend', '<div class="ptx7-adj-hint">Scan 2D barcodes now, or set quantities below.</div>');
    var rows = inDialog('tbody tr,[role="row"]').filter(function (r) { return r.querySelector('td,[role="cell"],[role="gridcell"]'); });
    rows.forEach(function (row) {
      var cells = [].slice.call(row.querySelectorAll(':scope > td,:scope > [role="cell"],:scope > [role="gridcell"]'));
      var texts = cells.map(function (c) { return normalize(c.innerText); });
      var radio = row.querySelector('input[type="radio"],[role="radio"]');
      var on = radio && (radio.checked || radio.getAttribute('aria-checked') === 'true');
      var num = function (t) { var m = String(t || '').match(/-?\d+(?:\.\d+)?/); return m ? m[0] : '0'; };
      var area = texts[1] || '', current = num(texts[2]), change = num(texts[3]), updated = num(texts[4]);
      var card = document.createElement('div'); card.className = 'ptx7-adj-card' + (on ? ' on' : '');
      card.innerHTML = '<div class="ptx7-adj-area">' + (on ? '\u25C9 ' : '\u25CB ') + esc(area) + '</div>' +
        '<div class="ptx7-adj-qty"><div><small>CURRENT</small>' + esc(current) + '</div><div><small>CHANGE</small><b>' + esc(change) + '</b></div><div><small>UPDATED</small>' + esc(updated) + '</div></div>';
      if (radio) card.querySelector('.ptx7-adj-area').addEventListener('click', function () { radio.click(); adjustSignature = ''; setTimeout(renderAdjust, 250); });
      var max = Math.max(0, Math.ceil(Number(String(current).replace(/[^\d.]/g, '')) || 0));
      var values = []; for (var n = 0; n <= Math.min(max || 50, 500); n++) values.push(String(n));
      var pencil = row.querySelector('button,[role="button"]');
      card.appendChild(buildWheel(values, String(Number(change) || 0), function (v) {
        if (pencil) pencil.click();
        setTimeout(function () {
          var input = row.querySelector('input:not([type="radio"])');
          if (input) { setTextValue(input, v); pressEnter(input); try { input.blur(); } catch (_) {} }
          adjustSignature = ''; setTimeout(renderAdjust, 350);
        }, 150);
      }));
      body.appendChild(card);
    });
    body.appendChild(adjustButton('BOTTLES NOT AVAILABLE', 'ghost wide', forward(/bottles not available/i)));
    var nav = document.createElement('div'); nav.className = 'ptx7-adj-nav';
    nav.appendChild(adjustButton('\u2039 BACK', 'ghost', forward(/^back$/i)));
    nav.appendChild(adjustButton('ADJUST INVENTORY', 'danger', function () {
      var go = dialogButton(/^adjust inventory$/i);
      if (!go) { showMessage('PIMS Adjust Inventory is not available yet.', false); return; }
      var sheet = document.createElement('div'); sheet.className = 'ptx7-adj-confirm';
      sheet.innerHTML = '<div class="box"><h2>SUBMIT ADJUSTMENT?</h2><p>' + esc(total || 'Review quantities before submitting.') + '</p>' +
        '<div class="ptx7-adj-nav"><button type="button" class="ptx7-adj-btn ghost">BACK</button><button type="button" class="ptx7-adj-btn danger">SUBMIT</button></div></div>';
      sheet.querySelector('.ghost').addEventListener('click', function () { sheet.remove(); });
      sheet.querySelector('.danger').addEventListener('click', function () { sheet.remove(); go.click(); });
      adjustRoot.appendChild(sheet);
    }));
    body.appendChild(nav);
    // Step 3 listens for 2D scans on the PIMS page itself: keep focus off our inputs.
    try { if (document.activeElement && adjustRoot.contains(document.activeElement)) document.activeElement.blur(); } catch (_) {}
  }

  function renderAdjust() {
    if (!adjustActive) return;
    adjustDialog = adjustNativeDialog();
    if (!adjustDialog) { adjustRoot.style.display = 'none'; return; }
    adjustRoot.style.display = 'flex';
    var step = stepNumber();
    var sig = step + '|' + inDialog('input,select,textarea,[role="radio"],[aria-haspopup="listbox"],tbody tr').length + '|' +
      inDialog('input[type="radio"],[role="radio"]').map(function (r) { return r.checked || r.getAttribute('aria-checked'); }).join('') + '|' +
      inDialog('tbody tr').map(function (r) { return normalize(r.innerText); }).join(';') + '|' + nativeSelects().map(selectValueText).join(';');
    if (sig === adjustSignature) return;
    adjustSignature = sig;
    adjustRoot.innerHTML = '<header class="ptx7-adj-head">ADJUST INVENTORY<button type="button" class="ptx7-adj-pims">PIMS FORM</button></header>';
    var body = document.createElement('main'); body.className = 'ptx7-adj-body'; adjustRoot.appendChild(body);
    adjustRoot.querySelector('.ptx7-adj-pims').addEventListener('click', function () {
      adjustActive = false; adjustRoot.style.display = 'none'; document.documentElement.classList.add('ptx7-native-action');
    });
    adjustHeader(body);
    if (step === 2) renderStep2(body); else if (step === 3) renderStep3(body); else renderStep1(body);
  }
  function openAdjustSkin() {
    adjustActive = true; adjustSignature = '';
    setTimeout(renderAdjust, 250); setTimeout(renderAdjust, 700);
  }
  function closeAdjustSkin() { optionCache = {}; adjustActive = false; adjustSignature = ''; adjustRoot.style.display = 'none'; adjustRoot.innerHTML = ''; }

  function showNativeInventory(targetLabel) {
    var target = targetLabel ? nativeButton(targetLabel) : null;
    if (targetLabel && !target) {
      showMessage(targetLabel + ' is not available for this product.', true);
      return;
    }
    inventorySimple = false;
    nativeActionActive = !!target;
    nativeDialogSeen = false;
    nativeActionStartedAt = Date.now();
    var adjusting = /adjust inventory/i.test(targetLabel || '') && !!target;
    document.documentElement.classList.toggle('ptx7-native-action', nativeActionActive && !adjusting);
    inventoryRoot.style.display = 'none';
    fullButton.textContent = 'RETURN TO SIMPLE INVENTORY';
    fullButton.style.display = adjusting ? 'none' : 'block';
    if (adjusting) openAdjustSkin();
    // This is the user's one tap, forwarded to the public native PIMS control.
    // No React internals or private handlers are invoked.
    if (target) setTimeout(function () { if (document.documentElement.contains(target)) target.click(); }, 0);
  }
  function showNativeLocation(targetLabel){
    var target=targetLabel?nativeButton(targetLabel):null;
    if(targetLabel&&!target){showMessage(targetLabel+' is not available on this location.',false);return;}
    locationsSimple=false;nativeActionActive=!!target;nativeDialogSeen=false;nativeActionStartedAt=Date.now();document.documentElement.classList.toggle('ptx7-native-action',nativeActionActive);locationRoot.style.display='none';fullButton.textContent='RETURN TO SIMPLE LOCATIONS';fullButton.style.display='block';
    if(target)setTimeout(function(){if(document.documentElement.contains(target))target.click();},0);
  }
  inventoryRoot.querySelector('#ptx7-show-full-inventory').addEventListener('click', function () { showNativeInventory(''); });
  [].slice.call(inventoryRoot.querySelectorAll('[data-native-control]')).forEach(function (button) {
    button.addEventListener('click', function () { showNativeInventory(button.getAttribute('data-native-control')); });
  });
  locationRoot.querySelector('#ptx7-full-location').addEventListener('click',function(){showNativeLocation('');});
  [].slice.call(locationRoot.querySelectorAll('[data-location-control]')).forEach(function(button){button.addEventListener('click',function(){showNativeLocation(button.getAttribute('data-location-control'));});});

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

  fullButton.addEventListener('click', function () { returnToSimple(currentMode()); });

  receivePoButton.addEventListener('click', function () {
    try {
      if (window.PTX7Host && window.PTX7Host.openCurrentPoReceiving) {
        window.PTX7Host.openCurrentPoReceiving();
        return;
      }
    } catch (_) {}
    if (window.__ptx7Rx && window.__ptx7Rx.open) window.__ptx7Rx.open();
  });

  function returnToSimple(mode) {
    closeAdjustSkin();
    nativeActionActive = false;
    nativeDialogSeen = false;
    document.documentElement.classList.remove('ptx7-native-action');
    fullButton.style.display = 'none';
    if (mode === 'inventory') {
      inventorySimple = true; inventoryRoot.style.display = 'flex'; lastRenderSignature = ''; renderInventory();
      setTimeout(function () { try { inventoryInput.focus({preventScroll:true}); } catch (_) {} }, 50);
    } else if (mode === 'locations') {
      locationsSimple = true; locationRoot.style.display = 'flex'; lastLocationSignature = ''; renderLocation();
      setTimeout(function () { try { locationInput.focus({preventScroll:true}); } catch (_) {} }, 50);
    }
  }
  function standDown() {
    inventoryRoot.style.display = 'none';
    locationRoot.style.display = 'none';
    adjustRoot.style.display = 'none';
    fullButton.style.display = 'none';
    receivePoButton.style.display = 'none';
    document.documentElement.classList.remove('ptx7-simple-pims');
  }

  function maintain() {
    // Never compete with Receiving for the screen, focus, or layout work.
    if (receivingOpen()) { standDown(); return; }
    var mode = currentMode();
    // Auto-return once the native Quick Move / Adjust / Add dialog closes.
    if (nativeActionActive && (mode === 'inventory' || mode === 'locations')) {
      var dialogOpen = nativeElements('[role="dialog"],[aria-modal="true"]').some(visible);
      if (dialogOpen) nativeDialogSeen = true;
      else if (nativeDialogSeen && Date.now() - nativeActionStartedAt > 600) { returnToSimple(mode); return; }
    }
    // Enlarge native PIMS only for plain fallback views; never under Receiving,
    // on the PO page, or while a native dialog has its own styling.
    var enlarged = (mode === 'inventory' || mode === 'locations') && !nativeActionActive;
    document.documentElement.classList.toggle('ptx7-simple-pims', enlarged);
    if (adjustActive) { fullButton.style.display = 'none'; renderAdjust(); }
    inventoryRoot.style.display = mode === 'inventory' && inventorySimple ? 'flex' : 'none';
    locationRoot.style.display = mode === 'locations' && locationsSimple ? 'flex' : 'none';
    receivePoButton.style.display = mode === 'po' ? 'block' : 'none';
    if (mode === 'locations') {
      if(locationsSimple){fullButton.style.display='none';scheduleLocationRender(120);var activeLocation=document.activeElement;if(!activeLocation||!locationRoot.contains(activeLocation)){try{locationInput.focus({preventScroll:true});}catch(_){}}}
      else {fullButton.style.display='block';fullButton.textContent='RETURN TO SIMPLE LOCATIONS';}
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
    if (!document.documentElement.contains(locationRoot)) document.body.appendChild(locationRoot);
    if (!document.documentElement.contains(fullButton)) document.body.appendChild(fullButton);
    if (!document.documentElement.contains(receivePoButton)) document.body.appendChild(receivePoButton);
    if (!document.documentElement.contains(message)) document.body.appendChild(message);
    if (!document.documentElement.contains(removeConfirm)) document.body.appendChild(removeConfirm);
    if (!document.documentElement.contains(adjustRoot)) document.body.appendChild(adjustRoot);
    if (adjustActive) fullButton.style.display = 'none';
  }

  new MutationObserver(function (mutations) {
    if (document.hidden || receivingOpen()) return;
    var nativeChanged=mutations.some(function(mutation){return !isToolElement(mutation.target);});
    if(!nativeChanged)return;
    clearTimeout(maintain.timer);
    maintain.timer = setTimeout(maintain, 120);
  }).observe(document.documentElement, {subtree:true, childList:true});
  maintain();
  setInterval(function(){ if (!document.hidden) maintain(); }, 1500);
  // Location selected from Inventory: search it as soon as Locations is ready.
  try {
    var pendingGoto = JSON.parse(sessionStorage.getItem(GOTO_KEY) || 'null');
    sessionStorage.removeItem(GOTO_KEY);
    if (pendingGoto && pendingGoto.code && Date.now() - Number(pendingGoto.at || 0) < 60000 && currentMode() === 'locations') {
      locationsSimple = true;
      submitLocationSearch(pendingGoto.code, true);
    }
  } catch (_) {}
  function enableTyping(input, mode) {
    input.setAttribute('inputmode', mode);
    input.value = '';
    try { input.blur(); } catch (_) {}
    setTimeout(function () { try { input.focus(); } catch (_) {} }, 30);
  }
  function restoreScanOnly(input) { input.setAttribute('inputmode', 'none'); }
  inventoryRoot.querySelector('#ptx7-inventory-type').addEventListener('click', function () { enableTyping(inventoryInput, 'numeric'); });
  locationRoot.querySelector('#ptx7-location-type').addEventListener('click', function () { enableTyping(locationInput, 'text'); });
  inventoryInput.addEventListener('blur', function () { restoreScanOnly(inventoryInput); });
  locationInput.addEventListener('blur', function () { restoreScanOnly(locationInput); });

  // Scans delivered by Android broadcast (not keystrokes) while Receiving is closed.
  function onHostScan(raw) {
    var value = String(raw == null ? '' : raw).trim();
    if (!value || receivingOpen()) return false;
    if (value === lastSubmitted && Date.now() - lastSubmittedAt < 1500) return false;
    var mode = currentMode();
    if (mode === 'inventory' && inventorySimple) return submitInventorySearch(value, true);
    if (mode === 'locations' && locationsSimple) return submitLocationSearch(value, true);
    return false;
  }
  // Android Back: leave a native fallback view and return to the simple view.
  function handleBack() {
    if (receivingOpen()) return false;
    var mode = currentMode();
    if ((mode === 'inventory' && !inventorySimple) || (mode === 'locations' && !locationsSimple)) { returnToSimple(mode); return true; }
    return false;
  }

  window.__ptx7PimsTools = {onHostScan:onHostScan, handleBack:handleBack, showInventory:function () {
    inventorySimple = true;
    nativeActionActive = false;
    document.documentElement.classList.remove('ptx7-native-action');
    fullButton.style.display='none';
    maintain();
    setTimeout(function(){try{inventoryInput.focus({preventScroll:true});}catch(_){}},0);
  }, showLocations:function(){locationsSimple=true;nativeActionActive=false;document.documentElement.classList.remove('ptx7-native-action');maintain();setTimeout(function(){try{locationInput.focus({preventScroll:true});}catch(_){}},0);}, inventoryUrl:INVENTORY_URL};
})();
