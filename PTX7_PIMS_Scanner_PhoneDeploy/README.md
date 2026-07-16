# PTX7 PIMS Scanner — Prototype v0.1

This Android prototype supports both requested workflows.

## Mode 1 — Standalone scanner
1. Tap **Scan**.
2. Scan a QR code, Data Matrix, Code 128, or Code 39 barcode.
3. The decoded value is automatically copied to the clipboard.
4. Tap **Open PIMS** to open the configured PIMS URL in your normal browser.
5. Paste into the Location Barcode field and submit.

## Mode 2 — Integrated PIMS
1. Tap **Integrated PIMS**.
2. Sign in to Amazon/PIMS if the page allows authentication inside Android WebView.
3. Leave **After each scan, send to integrated PIMS and submit** checked.
4. Tap **Scan**.
5. After a successful scan, the app searches the page for the Location Barcode field, inserts the scanned value, and clicks Submit.
6. If it cannot find Submit, it attempts to send an Enter key event instead.

## Build
Open the project folder in Android Studio and let Gradle sync.

Recommended:
- Android Studio with JDK 17
- Android SDK 35 installed
- A physical Android phone with Google Play services

Then:
- Build > Build APK(s)
- Install the generated APK on the test phone.

## Important limitations
- Amazon authentication may block or restrict WebView. If that happens, standalone mode still works.
- The integrated page injection depends on the PIMS page DOM. The script currently looks for an input whose placeholder/label/name/id contains "Location Barcode" or "location".
- The app does not use or store Amazon credentials.
- Scanned values are only held in memory and copied to the Android clipboard.
- This prototype does not yet use an Android Accessibility Service to type directly into Chrome. That can be added later if permitted by your device policy.

## Default PIMS URL
https://console.inventory.pharmacy.amazon.dev/inventory?facility=PTX7

You can edit the URL directly in the app before opening it.
