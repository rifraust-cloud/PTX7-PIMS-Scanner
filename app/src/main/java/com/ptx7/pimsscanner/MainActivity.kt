package com.ptx7.pimsscanner

import android.Manifest
import androidx.activity.ComponentActivity
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Bundle
import android.os.SystemClock
import android.util.Log
import android.view.View
import android.webkit.CookieManager
import android.webkit.WebChromeClient
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.CheckBox
import android.widget.EditText
import android.widget.TextView
import android.widget.Toast
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageProxy
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import com.google.mlkit.vision.barcode.BarcodeScanner
import com.google.mlkit.vision.barcode.BarcodeScanning
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.common.InputImage
import org.json.JSONObject
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

class MainActivity : ComponentActivity() {

    companion object {
        private const val CAMERA_PERMISSION_REQUEST = 1001
        private const val TAG = "PTX7Scanner"
    }

    private lateinit var previewView: PreviewView
    private lateinit var webView: WebView
    private lateinit var lastScanText: TextView
    private lateinit var debugText: TextView
    private lateinit var statusText: TextView
    private lateinit var pimsUrl: EditText
    private lateinit var autoSubmit: CheckBox
    private lateinit var autoScan: CheckBox
    private lateinit var scanNowButton: Button
    private lateinit var scannerCollapseButton: Button
    private lateinit var scannerSection: View

    private lateinit var cameraToggleButton: Button
    private lateinit var textSizeButton: Button
    private lateinit var fullscreenButton: Button
    private lateinit var zoomOutButton: Button
    private lateinit var zoomInButton: Button
    private lateinit var fitButton: Button
    private lateinit var zoomText: TextView
    private lateinit var appHeader: View
    private lateinit var pimsHeader: View
    private lateinit var zoomToolbar: View
    private lateinit var centerButton: Button

    private var pimsFullscreen = false

    // WebView's natural overview scale.
    private var fitScale = 0f

    // Prevent the FIT operation from being shown as manual zoom.
    private var restoringFit = false

    private lateinit var cameraExecutor: ExecutorService
    private lateinit var barcodeScanner: BarcodeScanner

    private var lastScanValue: String = ""
    private var lastAcceptedValue: String? = null
    private var lastAcceptedTime: Long = 0L
    private var manualScanRequested: Boolean = false
    private var lastAutoScanAttempt: Long = 0L

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        scannerCollapseButton = findViewById(R.id.scannerCollapseButton)
        scannerSection = findViewById(R.id.scannerSection)

        // Start with scanner controls minimized.
        scannerSection.visibility = View.GONE
        scannerCollapseButton.text = "SCANNER  ▼"

        scannerCollapseButton.setOnClickListener {
            if (scannerSection.visibility == View.VISIBLE) {
                scannerSection.visibility = View.GONE
                scannerCollapseButton.text = "SCANNER  ▼"
            } else {
                scannerSection.visibility = View.VISIBLE
                scannerCollapseButton.text = "SCANNER  ▲"
            }
        }


        previewView = findViewById(R.id.previewView)
        webView = findViewById(R.id.webView)
        lastScanText = findViewById(R.id.lastScan)
        debugText = findViewById(R.id.debugText)
        statusText = findViewById(R.id.statusText)
        pimsUrl = findViewById(R.id.pimsUrl)
        autoSubmit = findViewById(R.id.autoSubmit)
        autoScan = findViewById(R.id.autoScan)
        scanNowButton = findViewById(R.id.scanNowButton)
        cameraToggleButton = findViewById(R.id.cameraToggleButton)
        textSizeButton = findViewById(R.id.textSizeButton)

        fullscreenButton = findViewById(R.id.fullscreenButton)
        zoomOutButton = findViewById(R.id.zoomOutButton)
        zoomInButton = findViewById(R.id.zoomInButton)
        fitButton = findViewById(R.id.fitButton)
        zoomText = findViewById(R.id.zoomText)

        appHeader = findViewById(R.id.appHeader)
        pimsHeader = findViewById(R.id.pimsHeader)
        zoomToolbar = findViewById(R.id.zoomToolbar)
        centerButton = findViewById(R.id.centerButton)


        cameraExecutor = Executors.newSingleThreadExecutor()

        barcodeScanner = BarcodeScanning.getClient(
            com.google.mlkit.vision.barcode.BarcodeScannerOptions.Builder()
                .setBarcodeFormats(
                    Barcode.FORMAT_UPC_A,
                    Barcode.FORMAT_UPC_E,
                    Barcode.FORMAT_EAN_13,
                    Barcode.FORMAT_EAN_8,
                    Barcode.FORMAT_CODE_128,
                    Barcode.FORMAT_DATA_MATRIX,
                    Barcode.FORMAT_QR_CODE
                )
                .build()
        )

        configureWebView()

        findViewById<Button>(R.id.copyButton).setOnClickListener { copyLastScan() }
        findViewById<Button>(R.id.openChromeButton).setOnClickListener { openPimsExternally() }
        findViewById<Button>(R.id.loadIntegratedButton).setOnClickListener { loadIntegratedPims() }
        findViewById<Button>(R.id.sendToPageButton).setOnClickListener { sendLastScanToPage(submit = true) }

        scanNowButton.setOnClickListener {
            manualScanRequested = true
            statusText.visibility = View.VISIBLE
            statusText.text = "Ready for one scan..."
        }

        cameraToggleButton.setOnClickListener {
            if (previewView.visibility == View.VISIBLE) {
                previewView.visibility = View.GONE
                cameraToggleButton.text = "SHOW CAMERA"
            } else {
                previewView.visibility = View.VISIBLE
                cameraToggleButton.text = "HIDE CAMERA"
            }
        }

        /*
         * PIMS now uses WebView's native zoom instead of CSS document zoom.
         * CSS zoom was changing the webpage dimensions and causing the
         * off-center scrolling behavior.
         */

        zoomOutButton.setOnClickListener {

            restoringFit = false

            webView.zoomOut()

            webView.postDelayed({

                updateZoomLabel()

            }, 150)
        }


        zoomInButton.setOnClickListener {

            restoringFit = false

            webView.zoomIn()

            webView.postDelayed({

                updateZoomLabel()

            }, 150)
        }


        fitButton.setOnClickListener {

            fitToPage()
        }


        // The small PIM Console button is also a quick FIT shortcut.
        textSizeButton.setOnClickListener {

            fitToPage()
        }


        centerButton.setOnClickListener {

            centerActivePimsContent()
        }


        fullscreenButton.setOnClickListener {

            togglePimsFullscreen()
        }


        if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) ==
            PackageManager.PERMISSION_GRANTED
        ) {
            startCamera()
        } else {
            ActivityCompat.requestPermissions(
                this,
                arrayOf(Manifest.permission.CAMERA),
                CAMERA_PERMISSION_REQUEST
            )
        }
    }

    private fun startCamera() {
        statusText.text = "Starting CameraX scanner..."

        val cameraProviderFuture = ProcessCameraProvider.getInstance(this)

        cameraProviderFuture.addListener({
            val cameraProvider = cameraProviderFuture.get()

            val preview = Preview.Builder().build().also {
                it.setSurfaceProvider(previewView.surfaceProvider)
            }

            val imageAnalysis = ImageAnalysis.Builder()
                .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                .build()

            imageAnalysis.setAnalyzer(cameraExecutor) { imageProxy ->
                processImageProxy(imageProxy)
            }

            try {
                cameraProvider.unbindAll()

                cameraProvider.bindToLifecycle(
                    this,
                    CameraSelector.DEFAULT_BACK_CAMERA,
                    preview,
                    imageAnalysis
                )

                statusText.text = "Scanning..."
            } catch (e: Exception) {
                Log.e(TAG, "Camera binding failed", e)
                statusText.text = "Camera failed: ${e.message}"
            }

        }, ContextCompat.getMainExecutor(this))
    }

    private fun processImageProxy(imageProxy: ImageProxy) {
        val mediaImage = imageProxy.image

        if (mediaImage == null) {
            imageProxy.close()
            return
        }

        val rotation = imageProxy.imageInfo.rotationDegrees
        val inputImage = InputImage.fromMediaImage(mediaImage, rotation)

        barcodeScanner.process(inputImage)
            .addOnSuccessListener { barcodes ->
                for (barcode in barcodes) {
                    logBarcode(barcode, imageProxy)

                    val raw = barcode.rawValue?.trim().orEmpty()

                    if (raw.isNotBlank() && shouldAcceptScan(raw)) {
                        runOnUiThread {
                            handleSuccessfulScan(raw, barcode.format)
                        }
                        break
                    }
                }
            }
            .addOnFailureListener { error ->
                Log.e(TAG, "Barcode processing failed", error)
            }
            .addOnCompleteListener {
                imageProxy.close()
            }
    }

    private fun logBarcode(barcode: Barcode, imageProxy: ImageProxy) {
        val message = """
            rawValue=${barcode.rawValue}
            displayValue=${barcode.displayValue}
            rawBytes=${barcode.rawBytes?.contentToString()}
            format=${formatName(barcode.format)}
            valueType=${barcode.valueType}
            rotation=${imageProxy.imageInfo.rotationDegrees}
            frame=${imageProxy.width}x${imageProxy.height}
        """.trimIndent()

        Log.d(TAG, message)

        runOnUiThread {
            debugText.text = message
        }
    }

    private fun shouldAcceptScan(value: String): Boolean {
        val now = SystemClock.elapsedRealtime()

        val allowedByMode =
            if (manualScanRequested) {
                manualScanRequested = false
                true
            } else if (autoScan.isChecked) {
                if (now - lastAutoScanAttempt < 1000L) {
                    false
                } else {
                    lastAutoScanAttempt = now
                    true
                }
            } else {
                false
            }

        if (!allowedByMode) {
            return false
        }

        if (value == lastAcceptedValue && now - lastAcceptedTime < 1000L) {
            return false
        }

        lastAcceptedValue = value
        lastAcceptedTime = now
        return true
    }

    private fun handleSuccessfulScan(raw: String, format: Int) {
        lastScanValue = raw
        lastScanText.text = raw
        copyToClipboard(raw)

        val normalized = normalizeRetailBarcode(raw)

        statusText.text = """
            ✓ SCANNED
            Raw: $raw
            Normalized: $normalized
            Format: ${formatName(format)}
        """.trimIndent()

        if (autoSubmit.isChecked) {
            sendLastScanToPage(submit = true)
        }
    }

    private fun normalizeRetailBarcode(raw: String): String {
        val digits = raw.filter { it.isDigit() }

        return when {
            digits.length == 13 && digits.startsWith("0") -> digits.substring(1)
            else -> raw
        }
    }

    private fun formatName(format: Int): String {
        return when (format) {
            Barcode.FORMAT_UPC_A -> "UPC-A"
            Barcode.FORMAT_UPC_E -> "UPC-E"
            Barcode.FORMAT_EAN_13 -> "EAN-13"
            Barcode.FORMAT_EAN_8 -> "EAN-8"
            Barcode.FORMAT_CODE_128 -> "CODE-128"
            Barcode.FORMAT_DATA_MATRIX -> "DATA MATRIX"
            Barcode.FORMAT_QR_CODE -> "QR CODE"
            Barcode.FORMAT_CODE_39 -> "CODE-39"
            Barcode.FORMAT_CODE_93 -> "CODE-93"
            Barcode.FORMAT_ITF -> "ITF"
            Barcode.FORMAT_CODABAR -> "CODABAR"
            Barcode.FORMAT_PDF417 -> "PDF417"
            Barcode.FORMAT_AZTEC -> "AZTEC"
            else -> "FORMAT $format"
        }
    }

    private fun configureWebView() {

        webView.settings.javaScriptEnabled = true

        /*
         * Let WebView calculate the natural overview scale.
         *
         * We no longer modify document.body.style.zoom or page width.
         * Those CSS changes were the cause of the distorted page size and
         * excessive horizontal/vertical scrolling.
         */

        webView.settings.useWideViewPort = true
        webView.settings.loadWithOverviewMode = true

        webView.settings.setSupportZoom(true)

        // Keep pinch-to-zoom available without showing Android zoom buttons.
        webView.settings.builtInZoomControls = true
        webView.settings.displayZoomControls = false

        webView.settings.domStorageEnabled = true
        webView.settings.databaseEnabled = true

        webView.settings.userAgentString =
            webView.settings.userAgentString +
                " PTX7PimsScanner/0.5"

        // Zero allows WebView to calculate its initial overview scale.
        webView.setInitialScale(0)

        CookieManager.getInstance().setAcceptCookie(true)

        CookieManager.getInstance().setAcceptThirdPartyCookies(
            webView,
            true
        )


        webView.webViewClient =
            object : WebViewClient() {

                override fun onPageFinished(
                    view: WebView?,
                    url: String?
                ) {

                    super.onPageFinished(
                        view,
                        url
                    )

                    statusText.text =
                        "Integrated PIMS loaded"


                    /*
                     * Let the PIMS responsive layout settle before recording
                     * its natural fitted scale.
                     */

                    webView.postDelayed({

                        fitScale =
                            webView.scale

                        restoringFit =
                            true

                        zoomText.text =
                            "FIT"

                        textSizeButton.text =
                            "FIT"


                        injectPimsUiEnhancements()


                        webView.postDelayed({

                            restoringFit =
                                false

                        }, 300)

                    }, 500)
                }


                override fun onScaleChanged(
                    view: WebView?,
                    oldScale: Float,
                    newScale: Float
                ) {

                    super.onScaleChanged(
                        view,
                        oldScale,
                        newScale
                    )


                    if (!restoringFit) {

                        val percent =

                            (newScale * 100)
                                .toInt()
                                .coerceAtLeast(1)


                        zoomText.text =
                            "$percent%"


                        textSizeButton.text =
                            "$percent%"
                    }
                }
            }


        webView.webChromeClient =
            WebChromeClient()
    }


    private fun updateZoomLabel() {

        val percent =

            (webView.scale * 100)
                .toInt()
                .coerceAtLeast(1)


        zoomText.text =
            "$percent%"


        textSizeButton.text =
            "$percent%"
    }


    private fun fitToPage() {

        if (
            fitScale <= 0f ||
            webView.scale <= 0f
        ) {

            webView.scrollTo(
                0,
                0
            )

            zoomText.text =
                "FIT"

            textSizeButton.text =
                "FIT"

            return
        }


        restoringFit =
            true


        val factor =

            (fitScale / webView.scale)
                .coerceIn(
                    0.01f,
                    100f
                )


        webView.zoomBy(
            factor
        )


        /*
         * Reset the base PIMS page to its natural origin.
         *
         * Popups and active controls are centered independently by CENTER.
         */

        webView.scrollTo(
            0,
            0
        )


        zoomText.text =
            "FIT"


        textSizeButton.text =
            "FIT"


        webView.postDelayed({

            restoringFit =
                false

        }, 300)
    }


    /*
     * PIMS mobile interaction layer.
     *
     * This does not alter the main page dimensions.
     *
     * It:
     * - centers dropdown/listbox overlays;
     * - centers modal windows;
     * - enlarges dropdown choices for touch;
     * - creates a centered picker for standard HTML select controls;
     * - keeps focused fields visible above the keyboard.
     */

    private fun injectPimsUiEnhancements() {

        val javascript =
            """
            (function() {

                if (
                    window.__ptx7MobileUiInstalled
                ) {

                    if (
                        window.__ptx7CenterActiveContent
                    ) {

                        window
                            .__ptx7CenterActiveContent();
                    }

                    return;
                }


                window.__ptx7MobileUiInstalled =
                    true;



                function isVisible(element) {

                    if (!element) {

                        return false;
                    }


                    var style =

                        window
                            .getComputedStyle(
                                element
                            );


                    var rect =

                        element
                            .getBoundingClientRect();


                    return (

                        style.display !==
                            'none' &&

                        style.visibility !==
                            'hidden' &&

                        rect.width > 0 &&

                        rect.height > 0
                    );
                }



                /*
                 * Find the currently visible PIMS popup.
                 */

                function getActiveOverlay() {

                    var selectors = [

                        '[role="listbox"]',

                        '[role="dialog"]',

                        '[role="menu"]',

                        '[aria-modal="true"]'

                    ];


                    var candidates =
                        [];


                    selectors.forEach(

                        function(selector) {


                            Array
                                .from(

                                    document
                                        .querySelectorAll(
                                            selector
                                        )
                                )
                                .forEach(

                                    function(element) {


                                        if (
                                            isVisible(
                                                element
                                            )
                                        ) {

                                            candidates.push(
                                                element
                                            );
                                        }
                                    }
                                );
                        }
                    );


                    if (
                        candidates.length === 0
                    ) {

                        return null;
                    }


                    return candidates[
                        candidates.length - 1
                    ];
                }



                /*
                 * Center the current dropdown or popup.
                 */

                function centerOverlay() {

                    var target =
                        getActiveOverlay();


                    if (!target) {

                        return false;
                    }


                    var rect =

                        target
                            .getBoundingClientRect();


                    /*
                     * Do not rewrite a full-screen PIMS page.
                     */

                    if (

                        rect.width >=
                            window.innerWidth * 0.98 &&

                        rect.height >=
                            window.innerHeight * 0.95

                    ) {

                        return false;
                    }


                    target.style.setProperty(

                        'position',

                        'fixed',

                        'important'
                    );


                    target.style.setProperty(

                        'left',

                        '50%',

                        'important'
                    );


                    target.style.setProperty(

                        'top',

                        '50%',

                        'important'
                    );


                    target.style.setProperty(

                        'right',

                        'auto',

                        'important'
                    );


                    target.style.setProperty(

                        'bottom',

                        'auto',

                        'important'
                    );


                    target.style.setProperty(

                        'transform',

                        'translate(-50%, -50%)',

                        'important'
                    );


                    target.style.setProperty(

                        'margin',

                        '0',

                        'important'
                    );


                    target.style.setProperty(

                        'max-width',

                        'calc(100vw - 24px)',

                        'important'
                    );


                    target.style.setProperty(

                        'max-height',

                        '70vh',

                        'important'
                    );


                    target.style.setProperty(

                        'overflow-y',

                        'auto',

                        'important'
                    );


                    target.style.setProperty(

                        'z-index',

                        '2147483647',

                        'important'
                    );


                    /*
                     * Make dropdown choices easier to touch.
                     */

                    Array
                        .from(

                            target
                                .querySelectorAll(

                                    '[role="option"], li'

                                )
                        )
                        .forEach(

                            function(item) {


                                item.style
                                    .setProperty(

                                        'min-height',

                                        '48px',

                                        'important'
                                    );


                                item.style
                                    .setProperty(

                                        'font-size',

                                        '16px',

                                        'important'
                                    );
                            }
                        );


                    return true;
                }



                /*
                 * CENTER button behavior.
                 *
                 * Priority:
                 * 1. Center an active popup.
                 * 2. Center the currently focused control.
                 * 3. Center the main PIMS content horizontally.
                 */

                window.__ptx7CenterActiveContent =
                    function() {


                        if (
                            centerOverlay()
                        ) {

                            return;
                        }


                        var active =

                            document
                                .activeElement;


                        if (

                            active &&

                            active !==
                                document.body &&

                            active.scrollIntoView

                        ) {


                            active.scrollIntoView({

                                block:
                                    'center',

                                inline:
                                    'center',

                                behavior:
                                    'smooth'

                            });


                            return;
                        }


                        var main =

                            document.querySelector(

                                'main, [role="main"]'

                            );


                        if (main) {


                            var rect =

                                main
                                    .getBoundingClientRect();


                            var desiredLeft =

                                window.scrollX +

                                rect.left +

                                rect.width / 2 -

                                window.innerWidth / 2;


                            window.scrollTo({

                                left:
                                    Math.max(
                                        0,
                                        desiredLeft
                                    ),

                                top:
                                    window.scrollY,

                                behavior:
                                    'smooth'
                            });


                            return;
                        }


                        var pageWidth =

                            Math.max(

                                document.documentElement
                                    .scrollWidth,

                                document.body
                                    .scrollWidth
                            );


                        window.scrollTo({

                            left:
                                Math.max(

                                    0,

                                    (
                                        pageWidth -

                                        window.innerWidth
                                    ) / 2
                                ),

                            top:
                                window.scrollY,

                            behavior:
                                'smooth'
                        });
                    };



                /*
                 * Standard HTML SELECT controls:
                 *
                 * Replace the Android bottom picker with a centered,
                 * touch-friendly webpage dialog.
                 */

                document.addEventListener(

                    'click',

                    function(event) {


                        var target =
                            event.target;


                        if (
                            !target ||
                            !target.closest
                        ) {

                            return;
                        }


                        var select =

                            target.closest(
                                'select'
                            );


                        if (
                            !select ||
                            select.disabled ||
                            select.multiple
                        ) {

                            return;
                        }


                        event.preventDefault();

                        event.stopPropagation();

                        event.stopImmediatePropagation();



                        var existing =

                            document
                                .getElementById(

                                    'ptx7-select-overlay'

                                );


                        if (existing) {

                            existing.remove();
                        }



                        var backdrop =

                            document
                                .createElement(
                                    'div'
                                );


                        backdrop.id =

                            'ptx7-select-overlay';


                        backdrop.style.cssText =

                            'position:fixed;' +

                            'inset:0;' +

                            'background:rgba(0,0,0,0.45);' +

                            'display:flex;' +

                            'align-items:center;' +

                            'justify-content:center;' +

                            'padding:16px;' +

                            'z-index:2147483647;';



                        var card =

                            document
                                .createElement(
                                    'div'
                                );


                        card.style.cssText =

                            'width:min(92vw,520px);' +

                            'max-height:72vh;' +

                            'overflow:auto;' +

                            'background:white;' +

                            'border-radius:12px;' +

                            'box-shadow:0 12px 40px rgba(0,0,0,.35);' +

                            'padding:12px;';



                        Array
                            .from(
                                select.options
                            )
                            .forEach(

                                function(
                                    option,
                                    index
                                ) {


                                    if (
                                        option.disabled
                                    ) {

                                        return;
                                    }


                                    var button =

                                        document
                                            .createElement(
                                                'button'
                                            );


                                    button.type =
                                        'button';


                                    button.textContent =

                                        option
                                            .textContent
                                            .trim();


                                    button.style.cssText =

                                        'display:block;' +

                                        'width:100%;' +

                                        'min-height:52px;' +

                                        'margin:4px 0;' +

                                        'padding:10px 14px;' +

                                        'font-size:17px;' +

                                        'text-align:left;' +

                                        'background:' +

                                        (
                                            option.selected

                                            ?

                                            '#E6F4F5'

                                            :

                                            '#FFFFFF'
                                        ) +

                                        ';' +

                                        'border:1px solid #D5DDE0;' +

                                        'border-radius:8px;';



                                    button.onclick =

                                        function() {


                                            var setter =

                                                Object
                                                    .getOwnPropertyDescriptor(

                                                        window
                                                            .HTMLSelectElement
                                                            .prototype,

                                                        'value'

                                                    )
                                                    .set;


                                            setter.call(

                                                select,

                                                option.value
                                            );


                                            select.selectedIndex =
                                                index;


                                            select.dispatchEvent(

                                                new Event(

                                                    'input',

                                                    {
                                                        bubbles:
                                                            true
                                                    }
                                                )
                                            );


                                            select.dispatchEvent(

                                                new Event(

                                                    'change',

                                                    {
                                                        bubbles:
                                                            true
                                                    }
                                                )
                                            );


                                            backdrop.remove();


                                            select.blur();
                                        };


                                    card.appendChild(
                                        button
                                    );
                                }
                            );



                        backdrop.onclick =

                            function(clickEvent) {


                                if (
                                    clickEvent.target ===
                                        backdrop
                                ) {

                                    backdrop.remove();
                                }
                            };


                        backdrop.appendChild(
                            card
                        );


                        document.body.appendChild(
                            backdrop
                        );

                    },

                    true
                );



                /*
                 * PIMS often creates custom dropdowns dynamically.
                 * Watch for them and center them after they appear.
                 */

                var centerTimer =
                    null;


                var observer =

                    new MutationObserver(

                        function() {


                            clearTimeout(
                                centerTimer
                            );


                            centerTimer =

                                setTimeout(

                                    function() {

                                        centerOverlay();

                                    },

                                    80
                                );
                        }
                    );


                observer.observe(

                    document.documentElement,

                    {

                        childList:
                            true,

                        subtree:
                            true

                    }
                );



                /*
                 * Also retry after a user opens a combobox.
                 */

                document.addEventListener(

                    'click',

                    function(event) {


                        var target =
                            event.target;


                        if (
                            !target ||
                            !target.closest
                        ) {

                            return;
                        }


                        var trigger =

                            target.closest(

                                '[role="combobox"],' +

                                '[aria-haspopup="listbox"],' +

                                '[aria-haspopup="menu"]'

                            );


                        if (!trigger) {

                            return;
                        }


                        setTimeout(
                            centerOverlay,
                            60
                        );


                        setTimeout(
                            centerOverlay,
                            180
                        );


                        setTimeout(
                            centerOverlay,
                            350
                        );

                    },

                    true
                );



                /*
                 * Keep active entry fields visible above the keyboard.
                 */

                document.addEventListener(

                    'focusin',

                    function(event) {


                        var target =
                            event.target;


                        if (

                            !target ||

                            !target.matches ||

                            !target.matches(

                                'input, textarea'

                            )

                        ) {

                            return;
                        }


                        setTimeout(

                            function() {


                                target.scrollIntoView({

                                    block:
                                        'center',

                                    inline:
                                        'center',

                                    behavior:
                                        'smooth'

                                });

                            },

                            250
                        );

                    },

                    true
                );



                window
                    .__ptx7CenterActiveContent();


            })();
            """.trimIndent()


        webView.evaluateJavascript(

            javascript,

            null
        )
    }


    private fun centerActivePimsContent() {

        webView.evaluateJavascript(

            """
            if (
                window.__ptx7CenterActiveContent
            ) {

                window
                    .__ptx7CenterActiveContent();
            }
            """.trimIndent(),

            null
        )
    }


    private fun togglePimsFullscreen() {
        pimsFullscreen = !pimsFullscreen

        if (pimsFullscreen) {
            appHeader.visibility = View.GONE
            scannerCollapseButton.visibility = View.GONE
            scannerSection.visibility = View.GONE
            pimsHeader.visibility = View.GONE
            zoomToolbar.visibility = View.GONE

            fullscreenButton.text = "⛶"

            window.decorView.systemUiVisibility =
                View.SYSTEM_UI_FLAG_FULLSCREEN or
                View.SYSTEM_UI_FLAG_HIDE_NAVIGATION or
                View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY

        } else {
            appHeader.visibility = View.VISIBLE
            scannerCollapseButton.visibility = View.VISIBLE
            pimsHeader.visibility = View.VISIBLE
            zoomToolbar.visibility = View.VISIBLE

            window.decorView.systemUiVisibility =
                View.SYSTEM_UI_FLAG_VISIBLE
        }
    }

    private fun copyLastScan() {
        if (lastScanValue.isBlank()) {
            toast("Scan a code first")
            return
        }

        copyToClipboard(lastScanValue)
        statusText.text = "Copied to clipboard"
    }

    private fun copyToClipboard(value: String) {
        val clipboard =
            getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager

        clipboard.setPrimaryClip(
            ClipData.newPlainText("PIMS barcode", value)
        )
    }

    private fun openPimsExternally() {
        val url = pimsUrl.text.toString().trim()

        if (url.isBlank()) {
            toast("Enter the PIMS URL first")
            return
        }

        startActivity(
            Intent(Intent.ACTION_VIEW, Uri.parse(url))
        )
    }

    private fun loadIntegratedPims() {
        val url = pimsUrl.text.toString().trim()

        if (url.isBlank()) {
            toast("Enter the PIMS URL first")
            return
        }

        statusText.text = "Loading integrated PIMS..."
        webView.visibility = View.VISIBLE
        webView.loadUrl(url)
    }

    private fun sendLastScanToPage(submit: Boolean) {
        if (lastScanValue.isBlank()) {
            toast("Scan a code first")
            return
        }

        if (webView.url.isNullOrBlank()) {
            statusText.text = "Load Integrated PIMS first"
            return
        }

        val valueJson = JSONObject.quote(lastScanValue)
        val submitJs = if (submit) "true" else "false"

        val js = """
            (function() {
              const scanValue = $valueJson;
              const shouldSubmit = $submitJs;

              function visible(el) {
                const s = window.getComputedStyle(el);
                const r = el.getBoundingClientRect();

                return s.display !== 'none'
                    && s.visibility !== 'hidden'
                    && r.width > 0
                    && r.height > 0;
              }

              const inputs =
                Array.from(document.querySelectorAll('input, textarea'))
                    .filter(visible);

              let input = null;

              const active = document.activeElement;

              if (
                  active &&
                  (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA') &&
                  visible(active)
              ) {
                  input = active;
              }

              if (!input) {
                  input =
                    inputs.find(el => el === document.activeElement) ||
                    inputs.find(el => !el.disabled && !el.readOnly);
              }

              if (!input) {
                return JSON.stringify({
                    ok:false,
                    message:'No active input field found'
                });
              }

              input.focus();

              const proto =
                input.tagName === 'TEXTAREA'
                    ? window.HTMLTextAreaElement.prototype
                    : window.HTMLInputElement.prototype;

              const setter =
                Object.getOwnPropertyDescriptor(proto, 'value').set;

              setter.call(input, scanValue);

              input.dispatchEvent(
                  new Event('input', {bubbles:true})
              );

              input.dispatchEvent(
                  new Event('change', {bubbles:true})
              );

              if (shouldSubmit) {

                const buttons =
                  Array.from(
                    document.querySelectorAll(
                      'button, input[type=submit]'
                    )
                  ).filter(visible);

                const submitButton =
                  buttons.find(b => {

                    const txt =
                      (
                        b.innerText
                        || b.value
                        || b.getAttribute('aria-label')
                        || ''
                      )
                      .trim()
                      .toLowerCase();

                    return txt === 'submit'
                        || txt.includes('submit');
                  });

                if (submitButton) {
                  submitButton.click();

                  return JSON.stringify({
                    ok:true,
                    message:'Value entered and Submit clicked'
                  });
                }

                input.dispatchEvent(
                    new KeyboardEvent(
                        'keydown',
                        {
                            key:'Enter',
                            code:'Enter',
                            keyCode:13,
                            which:13,
                            bubbles:true
                        }
                    )
                );

                input.dispatchEvent(
                    new KeyboardEvent(
                        'keyup',
                        {
                            key:'Enter',
                            code:'Enter',
                            keyCode:13,
                            which:13,
                            bubbles:true
                        }
                    )
                );

                return JSON.stringify({
                    ok:true,
                    message:'Value entered; Enter key event sent'
                });
              }

              return JSON.stringify({
                  ok:true,
                  message:'Value entered'
              });

            })();
        """.trimIndent()

        webView.evaluateJavascript(js) { result ->

            statusText.text =
                when {
                    result.contains(
                        "Location input not found",
                        ignoreCase = true
                    ) ->
                        "Could not find an active PIMS input field"

                    result.contains(
                        "Submit clicked",
                        ignoreCase = true
                    ) ->
                        "Sent $lastScanValue and clicked Submit"

                    result.contains(
                        "Enter key event",
                        ignoreCase = true
                    ) ->
                        "Sent $lastScanValue and attempted Enter"

                    else ->
                        "Sent $lastScanValue to integrated PIMS"
                }
        }
    }

    private fun toast(message: String) {
        Toast.makeText(
            this,
            message,
            Toast.LENGTH_SHORT
        ).show()
    }

    override fun onRequestPermissionsResult(
        requestCode: Int,
        permissions: Array<out String>,
        grantResults: IntArray
    ) {
        super.onRequestPermissionsResult(
            requestCode,
            permissions,
            grantResults
        )

        if (
            requestCode == CAMERA_PERMISSION_REQUEST
            && grantResults.isNotEmpty()
            && grantResults[0] == PackageManager.PERMISSION_GRANTED
        ) {
            startCamera()
        } else {
            statusText.text = "Camera permission denied"
        }
    }

    override fun onDestroy() {
        super.onDestroy()

        barcodeScanner.close()
        cameraExecutor.shutdown()
    }

    override fun onBackPressed() {
        if (webView.canGoBack()) {
            webView.goBack()
        } else {
            super.onBackPressed()
        }
    }
}
