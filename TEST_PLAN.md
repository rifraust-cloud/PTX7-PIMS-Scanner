# PTX7 Scanner Test Plan

## Test 1 — Barcode decoding
Scan a known location label such as:
MANFW0105H08

Expected:
- Exact value appears on screen.
- Exact value is copied to clipboard.
- No spaces or added punctuation.

## Test 2 — External browser fallback
- Scan a location.
- Tap Open PIMS.
- Paste into Location Barcode.
- Verify PIMS accepts the value.

## Test 3 — Integrated WebView
- Tap Integrated PIMS.
- Authenticate if prompted.
- Navigate to Stock Locations > Location Management.
- Scan a known location.

Expected:
- Location Barcode field populates.
- Submit is clicked automatically.

## Capture if integrated mode fails
Please note:
- Does the Amazon login page load?
- Does PIMS load after login?
- Does the scanned value appear in the field?
- Does Submit click?
- Any message shown in the app status line.

Those answers will determine the next revision.
