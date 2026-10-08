# PTX7 PIMS Scanner — Base Receiving Test Plan

## Scope
Validate the base receive loop only. RS6100 configuration UI, voice, put-away,
and other later features are out of scope.

## Preconditions
- Install the APK built from version `1.1.0-beta.3` or later.
- Sign in to PIMS in the app.
- Open Simple Receiving and select a known receivable PO.
- Keep the PO selected through all item/location tests.
- Diagnostics should report `CAPTURED (native Android field)` during NDC and RECEIVE; PO selection remains tap-only.

## Test 1 — RS6100 item scan
Scan the known medication with the paired RS6100.

Expected:
- Captured input remains in PIMS colon form.
- Footer reports `pims-colon` and one delivery.
- PIMS opens the pending receive/location dialog.
- Medication details and all suggested locations mirror into Simple Receiving.

## Test 2 — PM86 built-in item scan
Scan the same medication with the PM86 built-in imager.

Known equivalent example:
- PM86 raw: `01 00360505083350 21 31160829 <GS> 17 280731 10 2606967`
- Delivered: `00360505083350:2606967:280731:31160829`

Expected:
- Footer reports `pm86-gs1-to-pims-colon`.
- PIMS responds exactly as in Test 1.
- Full GTIN, lot, expiration, and serial are preserved in PIMS order.
- The scan is delivered once.

## Test 3 — RS5100 compact GS1 item scan
Scan the same medication with an RS5100 profile that emits compact GS1.

Known equivalent example:
- RS5100 compact: `0100360505083350213116082917280731102606967`
- Delivered: `00360505083350:2606967:280731:31160829`

Expected:
- Footer reports `rs5100-compact-gs1-to-pims-colon`.
- Conversion occurs only when exactly one valid serial/expiration/lot split exists.
- PIMS responds exactly as in Tests 1 and 2.

## Test 4 — Location scan
With a medication pending, scan one PIMS-suggested location.

Expected:
- Location passes through unchanged.
- PIMS commits the receive.
- Progress updates from PIMS.
- Simple Receiving returns ready for the next item in the same PO.

## Test 5 — Duplicate protection
Perform one physical item scan while both native and WebView scanner paths are
available.

Expected:
- At most one PIMS receive is created.
- If the second path arrives within 750 ms, footer reports duplicate physical
  scan ignored.

## Test 6 — Unknown GS1 layout
Scan an item whose raw GS1 order is not recognized by the narrow adapter.

Expected:
- Footer reports `unrecognized-gs1-unchanged`.
- The app does not guess, reorder partial fields, or drop data.
- Capture diagnostics before adding support for another GS1 layout.

## Failure report
Record the first failed checkpoint:
1. Scanner paired/connected.
2. App captured the scan.
3. Footer format and delivered length.
4. PIMS opened pending receive.
5. Correct medication/progress/locations displayed.
6. Location committed.
7. Ready for next item in same PO.

## Diagnostic trace required for each scanner
Open Settings > Diagnostics after one scan and record:
- `focusMode` and native `focusedView`.
- Capture `source`, length, character codes, duration, event count, and terminator.
- Original and normalized escaped payloads.
- Normalization format.
- Forward sequence, event target, event count, duration, and terminator code.
- PIMS response result and latency.

Interpretation:
- No capture trace: fix Android HID/IME routing or focus.
- Partial length or no terminator: fix framing/timing.
- Complete capture but no forward trace: fix native-to-JS bridge.
- Complete forward trace but no PIMS dialog change: compare delivered event target,
  `which` character codes, timing, and payload to the successful PM86 trace.
- `cross-path-duplicate-suppressed`: two Android paths saw the same physical scan;
  only one was forwarded. A later intentional repeat from the same source remains valid.
