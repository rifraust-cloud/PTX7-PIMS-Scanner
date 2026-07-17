#!/usr/bin/env bash
set -euo pipefail
set +H

ACTIVITY="app/src/main/java/com/ptx7/pimsscanner/MainActivity.kt"
LAYOUT="app/src/main/res/layout/activity_main.xml"

if [[ ! -f "$ACTIVITY" ]]; then
  echo "ERROR: MainActivity.kt not found."
  echo "Run this script from the root of the PTX7-PIMS-Scanner repository."
  exit 1
fi

BACKUP_DIR="/tmp/ptx7-backup-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$BACKUP_DIR"
cp "$ACTIVITY" "$BACKUP_DIR/MainActivity.kt"
[[ -f "$LAYOUT" ]] && cp "$LAYOUT" "$BACKUP_DIR/activity_main.xml"
echo "Backup created at: $BACKUP_DIR"

python3 - <<'PY'
from pathlib import Path
path = Path("app/src/main/java/com/ptx7/pimsscanner/MainActivity.kt")
text = path.read_text(encoding="utf-8")
text = text.replace("minimum-scale=0.25", "minimum-scale=0.10")
text = text.replace('zoomText.text =\n            "PINCH"', 'zoomText.text =\n            ""')
text = text.replace('zoomText.text =\r\n            "PINCH"', 'zoomText.text =\r\n            ""')
text = text.replace('scannerCollapseButton.text = "SCANNER  ▼"', 'scannerCollapseButton.text = "PTX7  ▼"')
text = text.replace('scannerCollapseButton.text = "SCANNER  ▲"', 'scannerCollapseButton.text = "PTX7  ▲"')
path.write_text(text, encoding="utf-8")
print("MainActivity.kt patched.")
PY

cat > "$LAYOUT" <<'XML'
<?xml version="1.0" encoding="utf-8"?>
<LinearLayout
    xmlns:android="http://schemas.android.com/apk/res/android"
    android:id="@+id/rootLayout"
    android:layout_width="match_parent"
    android:layout_height="match_parent"
    android:orientation="vertical"
    android:background="#FFFFFF">

    <LinearLayout
        android:id="@+id/appHeader"
        android:layout_width="match_parent"
        android:layout_height="0dp"
        android:visibility="gone">
        <Button
            android:id="@+id/fullscreenButton"
            android:layout_width="1dp"
            android:layout_height="1dp" />
    </LinearLayout>

    <Button
        android:id="@+id/scannerCollapseButton"
        android:layout_width="match_parent"
        android:layout_height="36dp"
        android:minHeight="0dp"
        android:padding="0dp"
        android:backgroundTint="#007A83"
        android:text="PTX7  ▼"
        android:textColor="#FFFFFF"
        android:textStyle="bold"
        android:textSize="13sp" />

    <LinearLayout
        android:id="@+id/scannerSection"
        android:layout_width="match_parent"
        android:layout_height="wrap_content"
        android:orientation="vertical"
        android:padding="5dp"
        android:background="#F4F6F7"
        android:visibility="gone">

        <androidx.camera.view.PreviewView
            android:id="@+id/previewView"
            android:layout_width="match_parent"
            android:layout_height="72dp"
            android:background="#111111" />

        <EditText
            android:id="@+id/pimsUrl"
            android:layout_width="match_parent"
            android:layout_height="36dp"
            android:singleLine="true"
            android:textSize="10sp"
            android:text="https://console.inventory.pharmacy.amazon.dev" />

        <LinearLayout
            android:layout_width="match_parent"
            android:layout_height="36dp"
            android:orientation="horizontal"
            android:gravity="center_vertical">

            <Button
                android:id="@+id/scanNowButton"
                android:layout_width="0dp"
                android:layout_height="34dp"
                android:layout_weight="1"
                android:minWidth="0dp"
                android:minHeight="0dp"
                android:padding="0dp"
                android:text="SCAN"
                android:textSize="10sp"
                android:textStyle="bold" />

            <CheckBox
                android:id="@+id/autoScan"
                android:layout_width="wrap_content"
                android:layout_height="34dp"
                android:padding="0dp"
                android:text="Auto"
                android:textSize="10sp" />

            <Button
                android:id="@+id/cameraToggleButton"
                android:layout_width="84dp"
                android:layout_height="34dp"
                android:minWidth="0dp"
                android:minHeight="0dp"
                android:padding="0dp"
                android:text="HIDE CAMERA"
                android:textSize="8sp" />
        </LinearLayout>

        <TextView
            android:id="@+id/lastScan"
            android:layout_width="match_parent"
            android:layout_height="26dp"
            android:gravity="center_vertical"
            android:text="No scan yet"
            android:textStyle="bold"
            android:textSize="13sp"
            android:textColor="#172B3A" />

        <TextView
            android:id="@+id/debugText"
            android:layout_width="match_parent"
            android:layout_height="wrap_content"
            android:visibility="gone" />

        <TextView
            android:id="@+id/statusText"
            android:layout_width="match_parent"
            android:layout_height="wrap_content"
            android:minHeight="22dp"
            android:text="Starting scanner..."
            android:textSize="9sp"
            android:textColor="#666666" />

        <LinearLayout
            android:layout_width="match_parent"
            android:layout_height="34dp"
            android:orientation="horizontal">

            <Button
                android:id="@+id/copyButton"
                android:layout_width="0dp"
                android:layout_height="32dp"
                android:layout_weight="1"
                android:minWidth="0dp"
                android:minHeight="0dp"
                android:padding="0dp"
                android:text="COPY"
                android:textSize="8sp" />

            <Button
                android:id="@+id/openChromeButton"
                android:layout_width="0dp"
                android:layout_height="32dp"
                android:layout_weight="1"
                android:minWidth="0dp"
                android:minHeight="0dp"
                android:padding="0dp"
                android:text="OPEN"
                android:textSize="8sp" />

            <Button
                android:id="@+id/loadIntegratedButton"
                android:layout_width="0dp"
                android:layout_height="32dp"
                android:layout_weight="1"
                android:minWidth="0dp"
                android:minHeight="0dp"
                android:padding="0dp"
                android:text="LOAD"
                android:textSize="8sp" />

            <Button
                android:id="@+id/sendToPageButton"
                android:layout_width="0dp"
                android:layout_height="32dp"
                android:layout_weight="1"
                android:minWidth="0dp"
                android:minHeight="0dp"
                android:padding="0dp"
                android:text="SEND"
                android:textSize="8sp" />
        </LinearLayout>

        <CheckBox
            android:id="@+id/autoSubmit"
            android:layout_width="match_parent"
            android:layout_height="30dp"
            android:padding="0dp"
            android:text="Scan → PIMS → Submit automatically"
            android:textSize="10sp" />

        <LinearLayout
            android:id="@+id/zoomToolbar"
            android:layout_width="match_parent"
            android:layout_height="32dp"
            android:orientation="horizontal"
            android:gravity="end|center_vertical">

            <Button
                android:id="@+id/zoomOutButton"
                android:layout_width="28dp"
                android:layout_height="28dp"
                android:minWidth="0dp"
                android:minHeight="0dp"
                android:padding="0dp"
                android:text="−"
                android:textSize="14sp" />

            <TextView
                android:id="@+id/zoomText"
                android:layout_width="2dp"
                android:layout_height="28dp"
                android:text="" />

            <Button
                android:id="@+id/zoomInButton"
                android:layout_width="28dp"
                android:layout_height="28dp"
                android:minWidth="0dp"
                android:minHeight="0dp"
                android:padding="0dp"
                android:text="+"
                android:textSize="14sp" />

            <Button
                android:id="@+id/textSizeButton"
                android:layout_width="38dp"
                android:layout_height="28dp"
                android:minWidth="0dp"
                android:minHeight="0dp"
                android:padding="0dp"
                android:text="FIT"
                android:textSize="7sp" />

            <Button
                android:id="@+id/fitButton"
                android:layout_width="1dp"
                android:layout_height="1dp"
                android:visibility="invisible" />

            <Button
                android:id="@+id/centerButton"
                android:layout_width="48dp"
                android:layout_height="28dp"
                android:minWidth="0dp"
                android:minHeight="0dp"
                android:padding="0dp"
                android:text="CENTER"
                android:textSize="6sp" />
        </LinearLayout>
    </LinearLayout>

    <View
        android:id="@+id/pimsHeader"
        android:layout_width="match_parent"
        android:layout_height="0dp" />

    <WebView
        android:id="@+id/webView"
        android:layout_width="match_parent"
        android:layout_height="0dp"
        android:layout_weight="1"
        android:background="#FFFFFF" />

</LinearLayout>
XML

echo
echo "Checking MainActivity IDs against the layout..."
KOTLIN_IDS="$(mktemp)"
XML_IDS="$(mktemp)"
grep -oE 'R\.id\.[A-Za-z0-9_]+' "$ACTIVITY" | sed 's/R\.id\.//' | sort -u > "$KOTLIN_IDS"
grep -oE '@\+id/[A-Za-z0-9_]+' "$LAYOUT" | sed 's#@+id/##' | sort -u > "$XML_IDS"
MISSING="$(comm -23 "$KOTLIN_IDS" "$XML_IDS" || true)"
rm -f "$KOTLIN_IDS" "$XML_IDS"

if [[ -n "$MISSING" ]]; then
  echo "ERROR: Missing IDs:"
  echo "$MISSING"
  exit 1
fi

echo "All MainActivity layout IDs are present."
echo
echo "Compact UI fix installed."
echo "  - one 36dp PTX7 handle when collapsed"
echo "  - all scanner/configuration controls hidden behind the handle"
echo "  - no visible PINCH label"
echo "  - 28dp fallback +/- controls"
echo "  - requested minimum viewport scale changed to 10%"
echo
git status --short
git diff --stat
