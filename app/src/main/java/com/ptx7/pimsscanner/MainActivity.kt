package com.ptx7.pimsscanner

import android.widget.ImageButton
import android.view.HapticFeedbackConstants
import android.os.Build
import android.media.MediaActionSound
import android.Manifest
import androidx.activity.ComponentActivity
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.res.Configuration
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Bundle
import android.os.SystemClock
import android.util.Log
import android.view.View
import android.view.ViewGroup
import android.view.ScaleGestureDetector
import android.view.inputmethod.EditorInfo
import android.text.Editable
import android.text.InputType
import android.text.TextWatcher
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

        /*
         * The integrated camera scanner is tabled in favor of the device's
         * built-in keyboard-wedge imager. Flip to true to re-enable CameraX.
         */
        private const val CAMERA_SCANNER_ENABLED = false
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
    private lateinit var hardwareScanCapture: EditText
    private var updatingHardwareScanCapture = false
    private var hardwareCaptureStartedAt = 0L
    private var hardwareCaptureChangeCount = 0

    /*
     * Small floating one-shot scanner control.
     *
     * It remains available while the main scanner drawer is collapsed,
     * giving the user deliberate scan control without covering PIMS.
     */
    private lateinit var quickScanButton: ImageButton

    private lateinit var scanFeedbackSound: MediaActionSound

    private var manualScanFeedbackPending = false

    /*
     * True only when the floating camera button armed the scan.
     *
     * Floating camera behavior:
     * capture one barcode -> send to PIMS -> submit automatically.
     */
    private var quickScanSubmitPending = false



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
    private lateinit var scaleGestureDetector: ScaleGestureDetector

    private var pimsFullscreen = false

    // WebView's natural overview scale.
    private var fitScale = 0f

    // Last scale reported by WebView.
    private var lastKnownWebScale = 1f

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
        /*
         * Keep the clickable PTX7 app bar below Android's
         * system status bar.
         *
         * The status bar itself belongs to Android and cannot
         * receive taps for our scanner toggle.
         */
        window.statusBarColor =
            android.graphics.Color.parseColor("#007A83")

        window.navigationBarColor =
            android.graphics.Color.BLACK

        setContentView(R.layout.activity_main)

        scannerCollapseButton = findViewById(R.id.scannerCollapseButton)
        scannerSection = findViewById(R.id.scannerSection)

        quickScanButton =
            findViewById(
                R.id.quickScanButton
            )


        /*
         * Preload the sound once during Activity startup.
         *
         * The sound is played only for deliberate one-shot scans,
         * not continuous Auto Scan activity.
         */
        scanFeedbackSound =

            MediaActionSound().apply {

                load(
                    MediaActionSound.SHUTTER_CLICK
                )
            }


        // Start with scanner controls minimized.
        scannerSection.visibility = View.INVISIBLE
        scannerCollapseButton.text = "PIMS MOBILE   ▼"

        quickScanButton.visibility =
            if (CAMERA_SCANNER_ENABLED) View.VISIBLE else View.GONE


        scannerCollapseButton.setOnClickListener {

            if (
                scannerSection.visibility ==
                View.VISIBLE
            ) {

                scannerSection.visibility =
                    View.INVISIBLE

                scannerCollapseButton.text =
                    "PIMS MOBILE   ▼"

                /*
                 * Drawer is closed, so expose the compact
                 * one-shot camera control over PIMS.
                 */
                quickScanButton.visibility =
                    if (CAMERA_SCANNER_ENABLED) View.VISIBLE else View.GONE

            } else {

                scannerSection.visibility =
                    View.VISIBLE

                scannerCollapseButton.text =
                    "PIMS MOBILE   ▲"

                /*
                 * The full scanner controls already contain
                 * the normal SCAN button.
                 */
                quickScanButton.visibility =
                    View.GONE
            }
        }


        previewView = findViewById(R.id.previewView)
        webView = findViewById(R.id.webView)
        setupHardwareScanCapture()
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

        findViewById<Button>(R.id.receiveModeButton).setOnClickListener { openReceivingMode() }

        scanNowButton.setOnClickListener {

            armOneShotScan(
                fromFloatingButton = false
            )
        }


        /*
         * Compact one-shot scanner.
         *
         * This does not enable continuous Auto Scan mode.
         * It simply arms the next detected barcode.
         */
        quickScanButton.setOnClickListener {

            armOneShotScan(
                fromFloatingButton = true
            )
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

            webView.zoomOut()

            updateZoomLabel()
        }


        zoomInButton.setOnClickListener {

            webView.zoomIn()

            updateZoomLabel()
        }


        fitButton.setOnClickListener {

            fitToPage()
        }


        textSizeButton.setOnClickListener {

            fitToPage()
        }


        centerButton.setOnClickListener {

            centerActivePimsContent()
        }


        fullscreenButton.setOnClickListener {

            togglePimsFullscreen()
        }


        /*
         * Restore the current PIMS page after Activity recreation.
         *
         * On a normal fresh launch, automatically load Integrated PIMS so
         * the user does not have to press the button first.
         */
        if (savedInstanceState != null) {

            val restored =
                webView.restoreState(
                    savedInstanceState
                )

            if (restored == null) {
                loadIntegratedPims()
            }

        } else {

            loadIntegratedPims()
        }


        if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) ==
            PackageManager.PERMISSION_GRANTED
        ) {
            if (CAMERA_SCANNER_ENABLED) startCamera()
        } else {
            if (CAMERA_SCANNER_ENABLED) {
                ActivityCompat.requestPermissions(
                    this,
                    arrayOf(Manifest.permission.CAMERA),
                    CAMERA_PERMISSION_REQUEST
                )
            }
        }
    }


    /*
     * Arms exactly one barcode capture.
     *
     * CameraX is already bound and analyzing in the background,
     * so this only changes the acceptance state.
     */
    private fun armOneShotScan(

        fromFloatingButton: Boolean

    ) {

        manualScanRequested =
            true

        manualScanFeedbackPending =
            true

        /*
         * The floating camera is a deliberate one-shot
         * scan-and-submit action.
         */
        quickScanSubmitPending =
            fromFloatingButton


        statusText.visibility =
            View.VISIBLE

        statusText.text =
            "Ready for one scan..."


        if (
            fromFloatingButton
        ) {

            /*
             * Small visual change while waiting for the barcode.
             */
            quickScanButton
                .animate()
                .alpha(0.62f)
                .setDuration(100)
                .start()


            quickScanButton.performHapticFeedback(

                HapticFeedbackConstants
                    .KEYBOARD_TAP
            )


            Toast.makeText(

                this,

                "Ready for one barcode",

                Toast.LENGTH_SHORT

            ).show()
        }
    }



    /*
     * Confirmation for deliberate one-shot scans.
     *
     * Continuous Auto Scan does not use the shutter sound.
     */
    private fun playManualScanFeedback() {

        if (
            ::scanFeedbackSound.isInitialized
        ) {

            scanFeedbackSound.play(

                MediaActionSound
                    .SHUTTER_CLICK
            )
        }


        val hapticType =

            if (
                Build.VERSION.SDK_INT >=
                Build.VERSION_CODES.R
            ) {

                HapticFeedbackConstants
                    .CONFIRM

            } else {

                HapticFeedbackConstants
                    .LONG_PRESS
            }


        quickScanButton.performHapticFeedback(

            hapticType
        )


        quickScanButton
            .animate()
            .alpha(1.0f)
            .setDuration(120)
            .start()


        Toast.makeText(

            this,

            "Barcode captured",

            Toast.LENGTH_SHORT

        ).show()
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


    private fun handleSuccessfulScan(

        raw: String,

        format: Int

    ) {

        lastScanValue =
            raw

        lastScanText.text =
            raw


        /*
         * Capture whether this scan came from the floating
         * one-shot camera before clearing the flag.
         */
        val submitFromQuickCamera =

            quickScanSubmitPending


        quickScanSubmitPending =
            false


        /*
         * The floating camera is now a direct scan-and-submit
         * action rather than a clipboard-only action.
         *
         * Keep clipboard behavior for the normal scanner modes.
         */
        if (
            !submitFromQuickCamera
        ) {

            copyToClipboard(
                raw
            )
        }


        val normalized =

            normalizeRetailBarcode(
                raw
            )


        statusText.text =

            if (
                submitFromQuickCamera
            ) {

                """
                ✓ CAPTURED
                Sending to PIMS...
                """.trimIndent()

            } else {

                """
                ✓ SCANNED
                Raw: $raw
                Normalized: $normalized
                Format: ${formatName(format)}
                """.trimIndent()
            }


        /*
         * Give deliberate one-shot scans the shutter sound
         * and vibration confirmation.
         */
        if (
            manualScanFeedbackPending
        ) {

            manualScanFeedbackPending =
                false

            playManualScanFeedback()
        }


        /*
         * Floating camera ALWAYS sends and submits.
         *
         * All other scan methods continue respecting
         * the existing Auto Submit checkbox.
         */
        if (
            submitFromQuickCamera
            ||
            autoSubmit.isChecked
        ) {

            sendLastScanToPage(
                submit = true
            )
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

        webView.settings.javaScriptEnabled =
            true

        webView.settings.useWideViewPort =
            true

        webView.settings.loadWithOverviewMode =
            true

        /*
         * Programmatic zoom remains enabled.
         *
         * Built-in WebView gesture handling is disabled because PIMS may
         * consume multi-touch events before WebView processes them.
         *
         * Our ScaleGestureDetector below handles two-finger pinch directly.
         */
        webView.settings.setSupportZoom(
            true
        )

        webView.settings.builtInZoomControls = true

        webView.settings.displayZoomControls =
            false


        webView.settings.domStorageEnabled =
            true

        webView.settings.databaseEnabled =
            true


        webView.settings.userAgentString =

            webView.settings.userAgentString +

            " PIMSMobile/1.0"


        /*
         * Allow WebView to calculate its normal initial fit.
         */
        webView.setInitialScale(
            0
        )


        CookieManager
            .getInstance()
            .setAcceptCookie(
                true
            )


        CookieManager
            .getInstance()
            .setAcceptThirdPartyCookies(

                webView,

                true
            )


        webView.webViewClient =

            object : WebViewClient() {


                /*
                 * Midway / Amazon SSO redirects through custom URL schemes
                 * such as "aea://" and "intent://". A WebView only understands
                 * http(s) and otherwise fails with ERR_UNKNOWN_URL_SCHEME,
                 * which blocks the entire PIMS login.
                 *
                 * Hand any non-http(s) scheme to the Android system so the
                 * proper auth app (or Chrome) can complete the handshake, then
                 * control returns to the WebView for the https callback.
                 */
                override fun shouldOverrideUrlLoading(
                    view: WebView?,
                    request: android.webkit.WebResourceRequest?
                ): Boolean {
                    val uri = request?.url ?: return false
                    val scheme = (uri.scheme ?: "").lowercase()
                    if (scheme == "http" || scheme == "https") {
                        return false // let the WebView load it normally
                    }
                    return try {
                        if (scheme == "intent") {
                            // Resolve intent:// targets to a real Intent.
                            val intent = Intent.parseUri(
                                uri.toString(),
                                Intent.URI_INTENT_SCHEME
                            )
                            startActivity(intent)
                        } else {
                            startActivity(Intent(Intent.ACTION_VIEW, uri))
                        }
                        true // we handled it
                    } catch (e: Exception) {
                        Log.e(TAG, "No handler for scheme $scheme", e)
                        statusText.text = "No app available to handle $scheme sign-in"
                        true
                    }
                }


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
                     * Preserve PIMS's normal responsive width.
                     *
                     * Only remove restrictions that prevent zooming.
                     */
                    enablePimsPinchZoom()


                    webView.postDelayed({

                        /*
                         * Capture the first successfully rendered PIMS scale
                         * as the FIT baseline.
                         *
                         * We do NOT display this raw Android scale value.
                         */
                        if (
                            fitScale <= 0f
                        ) {

                            fitScale =
                                webView.scale
                        }


                        lastKnownWebScale =
                            webView.scale


                        updateZoomLabel()


                        injectPimsUiEnhancements()


                        installReceivingMode()


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


                    lastKnownWebScale =
                        newScale


                    /*
                     * Never expose Android's density-based raw scale.
                     *
                     * On the Samsung this is where values such as 375%
                     * originated.
                     */
                    updateZoomLabel()
                }
            }


        webView.webChromeClient =

            WebChromeClient()
    }



    /*
     * Explicit pinch zoom.
     *
     * This watches all touch events sent to the WebView but does not consume
     * normal one-finger taps or scrolling.
     */
    private fun configurePinchZoom() {

        scaleGestureDetector =

            ScaleGestureDetector(

                this,

                object :

                    ScaleGestureDetector
                        .SimpleOnScaleGestureListener() {


                    override fun onScaleBegin(

                        detector: ScaleGestureDetector

                    ): Boolean {

                        return true
                    }


                    override fun onScale(

                        detector: ScaleGestureDetector

                    ): Boolean {


                        val factor =

                            detector
                                .scaleFactor
                                .coerceIn(

                                    0.85f,

                                    1.15f
                                )


                        if (

                            factor.isFinite() &&

                            factor > 0f

                        ) {

                            webView.zoomBy(
                                factor
                            )


                            updateZoomLabel()
                        }


                        return true
                    }
                }
            )


        webView.setOnTouchListener {
                _,
                event ->


            scaleGestureDetector
                .onTouchEvent(
                    event
                )


            /*
             * Single-finger events continue to PIMS for normal tapping
             * and scrolling.
             *
             * Two-finger events belong to our pinch zoom handler.
             */

            event.pointerCount > 1 ||

            scaleGestureDetector
                .isInProgress
        }
    }




    /*
     * Large-screen virtual PIMS viewport.
     *
     * Instead of rendering the phone version of PIMS and then trying
     * to shrink it beyond WebView's zoom floor, PIMS is given a large
     * desktop/tablet-sized CSS viewport first.
     *
     * Portrait  = 1800 CSS px
     * Landscape = 2200 CSS px
     *
     * WebView can then show the complete large-screen layout at its
     * minimum overview scale and users can pinch inward/outward
     * naturally from there.
     */
    private fun enablePimsPinchZoom() {

        val virtualWidth =

            if (
                resources.configuration.orientation ==
                Configuration.ORIENTATION_LANDSCAPE
            ) {

                2200

            } else {

                1800
            }


        val javascript =

            """
            (function() {

                var virtualWidth =
                    $virtualWidth;


                var viewport =

                    document.querySelector(
                        'meta[name="viewport"]'
                    );


                if (!viewport) {

                    viewport =

                        document.createElement(
                            'meta'
                        );


                    viewport.name =
                        'viewport';


                    document.head.appendChild(
                        viewport
                    );
                }


                /*
                 * Give PIMS a real large-screen layout width.
                 *
                 * This changes responsive breakpoints before zooming,
                 * rather than attempting to shrink a phone layout.
                 */

                viewport.setAttribute(

                    'content',

                    'width=' +

                    virtualWidth +

                    ', initial-scale=1.0' +

                    ', minimum-scale=0.05' +

                    ', maximum-scale=5.0' +

                    ', user-scalable=yes'
                );


                /*
                 * Some PIMS pages use their own responsive containers.
                 * Maintain the large layout canvas at the document level.
                 */

                var style =

                    document.getElementById(

                        'ptx7-desktop-viewport-style'

                    );


                if (!style) {

                    style =

                        document.createElement(
                            'style'
                        );


                    style.id =

                        'ptx7-desktop-viewport-style';


                    document.head.appendChild(
                        style
                    );
                }


                style.textContent =

                    'html, body {' +

                    'min-width:' +

                    virtualWidth +

                    'px !important;' +

                    '}';


                document.documentElement
                    .style
                    .minWidth =

                    virtualWidth +
                    'px';


                if (document.body) {

                    document.body
                        .style
                        .minWidth =

                        virtualWidth +
                        'px';
                }


                /*
                 * Tell responsive components to recalculate themselves.
                 */

                window.dispatchEvent(

                    new Event(
                        'resize'
                    )
                );


                return JSON.stringify({

                    virtualWidth:
                        virtualWidth,

                    contentWidth:
                        document.documentElement
                            .scrollWidth

                });

            })();
            """.trimIndent()


        webView.evaluateJavascript(

            javascript

        ) {


            /*
             * Allow PIMS a moment to reflow into the new wide viewport,
             * then move WebView to its true minimum overview scale.
             */

            webView.postDelayed({

                zoomToMinimumOverview()

            }, 400)
        }
    }



    /*
     * Repeatedly step outward until WebView reports that no additional
     * native zoom-out level is available.
     *
     * Because the document now has a much larger virtual width,
     * this minimum scale represents a much wider PIMS overview than
     * the old phone-layout minimum.
     */
    private fun zoomToMinimumOverview(

        remainingSteps: Int = 30

    ) {

        if (
            remainingSteps <= 0
        ) {

            webView.scrollTo(
                0,
                0
            )

            return
        }


        if (
            !webView.canZoomOut()
        ) {

            webView.scrollTo(
                0,
                0
            )

            return
        }


        val changed =

            webView.zoomOut()


        if (changed) {

            webView.postDelayed({

                zoomToMinimumOverview(

                    remainingSteps - 1

                )

            }, 35)

        } else {

            webView.scrollTo(
                0,
                0
            )
        }
    }



    /*
     * We deliberately do not display a numeric zoom percentage.
     *
     * Android WebView scale values are affected by device density and caused
     * the misleading 375% number.
     */
    private fun updateZoomLabel() {

        /*
         * Do not display Android's raw WebView scale.
         *
         * The Samsung reports density-dependent values such as 3.75,
         * which previously appeared as the misleading 375%.
         */

        zoomText.text =
            ""


        textSizeButton.text =
            "FIT"
    }




    private fun fitToPage() {

        enablePimsPinchZoom()


        webView.postDelayed({

            centerActivePimsContent()

        }, 650)
    }



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
            scannerSection.visibility = View.INVISIBLE
            pimsHeader.visibility = View.GONE
            zoomToolbar.visibility = View.GONE

            fullscreenButton.text = "⛶"

            window.decorView.systemUiVisibility =
                View.SYSTEM_UI_FLAG_FULLSCREEN or
                View.SYSTEM_UI_FLAG_HIDE_NAVIGATION or
                View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY

        } else {
            appHeader.visibility = View.VISIBLE
            scannerCollapseButton.visibility = View.GONE
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

    override fun onSaveInstanceState(
        outState: Bundle
    ) {

        webView.saveState(
            outState
        )

        super.onSaveInstanceState(
            outState
        )
    }


    override fun onConfigurationChanged(
        newConfig: Configuration
    ) {

        super.onConfigurationChanged(
            newConfig
        )


        /*
         * The Activity is preserved during phone rotation, so the current
         * PIMS page remains open instead of returning to an empty WebView.
         *
         * Reapply the desktop viewport after the new dimensions settle.
         */

        webView.postDelayed({

            webView.requestLayout()
            webView.invalidate()

            enablePimsPinchZoom()

            injectPimsUiEnhancements()

            centerActivePimsContent()

        }, 350)
    }



    // ------------------------------------------------------------------
    // Receiving Mode
    //
    // A simplified, large-button receiving flow driven by the device's
    // built-in keyboard-wedge scanner. The UI lives in the injected
    // assets/ptx7_receiving_mode.js overlay; this host code only loads it,
    // toggles it, and exposes a tiny bridge back to Android.
    // ------------------------------------------------------------------

    private var receivingModeInstalled = false

    private fun readAsset(name: String): String {
        return try {
            assets.open(name).bufferedReader().use { it.readText() }
        } catch (e: Exception) {
            Log.e(TAG, "Failed to read asset $name", e)
            ""
        }
    }

    /*
     * Inject the Receiving Mode overlay script into the current PIMS page.
     * Safe to call on every page load; the script no-ops if already present.
     */
    /**
     * One native editable target for every keyboard-wedge scanner.
     *
     * PM86, RS6100, and RS5100 can use different Android input paths even when
     * Notes displays identical text. A focused native EditText accepts both
     * hardware KeyEvents and IME commitText; every completed scan then enters
     * the same JS normalization/deduplication/PIMS delivery path.
     */
    private fun setupHardwareScanCapture() {
        hardwareScanCapture = EditText(this).apply {
            layoutParams = ViewGroup.LayoutParams(1, 1)
            alpha = 0.01f
            isSingleLine = true
            cursorVisible = false
            setBackgroundColor(android.graphics.Color.TRANSPARENT)
            setTextColor(android.graphics.Color.TRANSPARENT)
            inputType = InputType.TYPE_CLASS_TEXT or
                InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS or
                InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD
            imeOptions = EditorInfo.IME_ACTION_DONE or EditorInfo.IME_FLAG_NO_EXTRACT_UI
            showSoftInputOnFocus = false
            contentDescription = "Hardware scanner capture"
            visibility = View.GONE
        }
        addContentView(hardwareScanCapture, ViewGroup.LayoutParams(1, 1))
        hardwareScanCapture.addTextChangedListener(object : TextWatcher {
            override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) = Unit
            override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) = Unit
            override fun afterTextChanged(value: Editable?) {
                if (updatingHardwareScanCapture || !receivingModeOpen || !assistantOwnsScanNative) return
                if (value.isNullOrEmpty()) return
                if (hardwareCaptureStartedAt == 0L) hardwareCaptureStartedAt = SystemClock.elapsedRealtime()
                hardwareCaptureChangeCount += 1
                hardwareScanCapture.removeCallbacks(hardwareCaptureFlushRunnable)
                hardwareScanCapture.postDelayed(hardwareCaptureFlushRunnable, 180L)
            }
        })
        hardwareScanCapture.setOnEditorActionListener { _, actionId, event ->
            val terminator = actionId == EditorInfo.IME_ACTION_DONE ||
                event?.keyCode == android.view.KeyEvent.KEYCODE_ENTER ||
                event?.keyCode == android.view.KeyEvent.KEYCODE_TAB
            if (terminator) {
                val reason = if (event?.keyCode == android.view.KeyEvent.KEYCODE_TAB) "TAB" else "ENTER_OR_IME_ACTION"
                flushHardwareCaptureInput(reason)
                true
            } else false
        }
    }

    private val hardwareCaptureFlushRunnable = Runnable { flushHardwareCaptureInput("TIMEOUT_180MS") }

    private fun flushHardwareCaptureInput(terminator: String = "TIMEOUT_180MS") {
        if (!::hardwareScanCapture.isInitialized) return
        val scan = hardwareScanCapture.text.toString().trimEnd('\r', '\n')
        if (scan.isEmpty()) return
        val startedAt = if (hardwareCaptureStartedAt > 0L) hardwareCaptureStartedAt else SystemClock.elapsedRealtime()
        val eventCount = hardwareCaptureChangeCount
        updatingHardwareScanCapture = true
        hardwareScanCapture.text.clear()
        updatingHardwareScanCapture = false
        hardwareCaptureStartedAt = 0L
        hardwareCaptureChangeCount = 0
        forwardScanToOverlay(scan, "native-edittext", terminator, startedAt, eventCount)
        hardwareScanCapture.postDelayed({ updateHardwareScanFocus() }, 30L)
    }

    private fun updateHardwareScanFocus() {
        if (!::hardwareScanCapture.isInitialized || !::webView.isInitialized) return
        if (receivingModeOpen && assistantOwnsScanNative) {
            hardwareScanCapture.visibility = View.VISIBLE
            hardwareScanCapture.requestFocus()
            hardwareScanCapture.setSelection(hardwareScanCapture.text.length)
        } else {
            hardwareScanCapture.removeCallbacks(hardwareCaptureFlushRunnable)
            updatingHardwareScanCapture = true
            hardwareScanCapture.text.clear()
            updatingHardwareScanCapture = false
            hardwareCaptureStartedAt = 0L
            hardwareCaptureChangeCount = 0
            hardwareScanCapture.clearFocus()
            hardwareScanCapture.visibility = View.GONE
            webView.requestFocus()
        }
    }

    private fun installReceivingMode() {
        val js = readAsset("ptx7_receiving_mode.js")
        if (js.isBlank()) {
            statusText.text = "Receiving Mode script missing"
            return
        }
        webView.evaluateJavascript(js, null)
        receivingModeInstalled = true
    }

    private fun openReceivingMode() {
        // Ensure the script is present (page may have navigated), then open.
        val js = readAsset("ptx7_receiving_mode.js")
        if (js.isBlank()) {
            toast("Receiving Mode script missing")
            return
        }
        // Register the native<->JS bridge once so the overlay can tell us when
        // it closes (so we stop intercepting hardware-scanner keys).
        registerReceivingBridge()
        // The script sets this flag path so it opens immediately after install.
        webView.evaluateJavascript("window.__ptx7RxReopen = true;", null)
        webView.evaluateJavascript(js) {
            webView.evaluateJavascript(
                "if (window.__ptx7Rx) window.__ptx7Rx.open();", null
            )
        }
        receivingModeInstalled = true
        receivingModeOpen = true
        scanBuffer.setLength(0)
        updateHardwareScanFocus()
        statusText.text = "Receiving Mode"
    }

    // ------------------------------------------------------------------
    // Native hardware-scanner (keyboard-wedge) capture
    //
    // Many rugged imagers deliver scans as hardware key events to the
    // Activity, NOT to the WebView DOM, so a JS keydown listener never sees
    // them. We intercept them here, assemble the barcode, and forward the
    // completed scan into the overlay via JavaScript.
    // ------------------------------------------------------------------

    @Volatile private var receivingModeOpen = false
    // True only while the assistant owns the scan (NDC lookup phase). During
    // PO select / RECEIVE this is false so key events pass through to PIMS.
    @Volatile private var assistantOwnsScanNative = true
    private val scanBuffer = StringBuilder()
    private var scanBufferStartedAt = 0L
    private var scanBufferEventCount = 0
    private var lastScanKeyAt = 0L
    private var receivingBridgeRegistered = false

    private fun registerReceivingBridge() {
        if (receivingBridgeRegistered) return
        webView.addJavascriptInterface(object {
            @android.webkit.JavascriptInterface
            fun onReceivingClosed() {
                runOnUiThread {
                    receivingModeOpen = false
                    assistantOwnsScanNative = true
                    scanBuffer.setLength(0)
                    updateHardwareScanFocus()
                }
            }
            // JS tells us whether it currently owns the scan (NDC phase=true;
            // PO/RECEIVE=false) so native key interception matches.
            @android.webkit.JavascriptInterface
            fun setScanOwnership(owns: Boolean) {
                runOnUiThread {
                    assistantOwnsScanNative = owns
                    updateHardwareScanFocus()
                }
            }
            @android.webkit.JavascriptInterface
            fun usesNativeCapture(): Boolean = true
            @android.webkit.JavascriptInterface
            fun requestScanFocus() {
                runOnUiThread { updateHardwareScanFocus() }
            }
        }, "PTX7Host")
        receivingBridgeRegistered = true
    }

    private fun focusDescription(): String {
        val view = currentFocus ?: return "none"
        val idName = if (view.id != View.NO_ID) {
            try { resources.getResourceEntryName(view.id) } catch (_: Exception) { view.id.toString() }
        } else "no-id"
        return "${view.javaClass.simpleName}#$idName:${view.contentDescription ?: ""}"
    }

    private fun escapedPayload(value: String): String = buildString {
        value.forEach { character ->
            if (character.code < 32 || character.code == 127) append("<%02X>".format(character.code))
            else append(character)
        }
    }

    private fun forwardScanToOverlay(
        scan: String,
        source: String,
        terminator: String,
        startedAt: Long,
        eventCount: Int
    ) {
        if (scan.isEmpty()) return
        val completedAt = SystemClock.elapsedRealtime()
        val trace = JSONObject().apply {
            put("source", source)
            put("focusedView", focusDescription())
            put("capturedLength", scan.length)
            put("escapedPayload", escapedPayload(scan))
            put("characterCodes", scan.map { it.code }.joinToString(","))
            put("terminator", terminator)
            put("eventCount", eventCount)
            put("captureDurationMs", (completedAt - startedAt).coerceAtLeast(0L))
            put("capturedAtElapsedMs", completedAt)
        }
        val quotedScan = JSONObject.quote(scan)
        val quotedTrace = JSONObject.quote(trace.toString())
        webView.evaluateJavascript(
            "if (window.__ptx7Rx) {" +
                "if (window.__ptx7Rx.onHostScanTrace) window.__ptx7Rx.onHostScanTrace($quotedScan,$quotedTrace);" +
                "else if (window.__ptx7Rx.onHostScan) window.__ptx7Rx.onHostScan($quotedScan);" +
            "}",
            null
        )
    }

    private fun flushScanBuffer(terminator: String = "TIMEOUT_180MS") {
        if (scanBuffer.isEmpty()) return
        val scan = scanBuffer.toString()
        val startedAt = if (scanBufferStartedAt > 0L) scanBufferStartedAt else SystemClock.elapsedRealtime()
        val eventCount = scanBufferEventCount
        scanBuffer.setLength(0)
        scanBufferStartedAt = 0L
        scanBufferEventCount = 0
        forwardScanToOverlay(scan, "activity-keyevent", terminator, startedAt, eventCount)
    }

    override fun dispatchKeyEvent(event: android.view.KeyEvent): Boolean {
        // Only intercept while Receiving Mode is open; otherwise behave normally.
        // Only intercept keys when the assistant owns the scan (NDC lookup
        // phase). During PO select / RECEIVE, PIMS owns the scan, so let the
        // key stream pass straight through to the WebView/PIMS.
        if (!receivingModeOpen || !assistantOwnsScanNative) return super.dispatchKeyEvent(event)
        if (event.action != android.view.KeyEvent.ACTION_DOWN) {
            // Swallow matching UP events for keys we consume on DOWN.
            return super.dispatchKeyEvent(event)
        }

        val keyCode = event.keyCode
        // Terminators: Enter / Tab complete a scan.
        if (keyCode == android.view.KeyEvent.KEYCODE_ENTER ||
            keyCode == android.view.KeyEvent.KEYCODE_NUMPAD_ENTER ||
            keyCode == android.view.KeyEvent.KEYCODE_TAB
        ) {
            val terminator = if (keyCode == android.view.KeyEvent.KEYCODE_TAB) "TAB" else "ENTER"
            flushScanBuffer(terminator)
            flushHardwareCaptureInput(terminator)
            return true
        }

        // Printable character from the wedge?
        val ch = event.unicodeChar
        if (ch != 0) {
            val now = SystemClock.elapsedRealtime()
            // A long pause means a new scan; reset the buffer.
            if (now - lastScanKeyAt > 300L) {
                scanBuffer.setLength(0)
                scanBufferStartedAt = now
                scanBufferEventCount = 0
            }
            if (scanBuffer.isEmpty()) scanBufferStartedAt = now
            lastScanKeyAt = now
            scanBufferEventCount += 1
            scanBuffer.append(ch.toChar())
            // Fallback flush for imagers that do not send Enter: a short pause
            // after the last character closes the scan.
            webView.removeCallbacks(scanFlushRunnable)
            webView.postDelayed(scanFlushRunnable, 180L)
            return true
        }

        return super.dispatchKeyEvent(event)
    }

    private val scanFlushRunnable = Runnable { flushScanBuffer("TIMEOUT_180MS") }

    // ------------------------------------------------------------------
    // PointMobile / OEM scanner Intent broadcast capture
    //
    // The PM86's imager is configured to BROADCAST decoded barcodes via an
    // OEM scanner service rather than inject key events, so dispatchKeyEvent
    // never sees them. Register a receiver for the common OEM scan actions and
    // forward the decoded value into the Receiving overlay.
    // ------------------------------------------------------------------

    private val scanReceiver = object : android.content.BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            if (intent == null) return
            val found = extractScanDataDiagnostic(intent) ?: return
            val action = intent.action ?: "(no action)"
            val data = found.second.trimEnd('\r', '\n')
            if (data.isBlank()) return
            runOnUiThread {
                // Always surface how the scan arrived so we can confirm/lock the
                // exact OEM action+extra on-device, then forward to the overlay.
                val diag = "via $action [${found.first}]"
                webView.evaluateJavascript(
                    "if (window.__ptx7Rx && window.__ptx7Rx.onHostScanDiag) " +
                        "window.__ptx7Rx.onHostScanDiag(${JSONObject.quote(data)}, ${JSONObject.quote(diag)});",
                    null
                )
                if (receivingModeOpen) {
                    val now = SystemClock.elapsedRealtime()
                    forwardScanToOverlay(data, "oem-broadcast:$action:${found.first}", "BROADCAST_COMPLETE", now, 1)
                }
            }
        }
    }

    // Returns Pair(extraKeyName, value) for the first barcode-looking string
    // extra on the intent, so the probe can report the exact source.
    private fun extractScanDataDiagnostic(intent: Intent): Pair<String, String>? {
        val knownKeys = listOf(
            "device.scanner.event.EXTRA_DATA",            // PointMobile
            "data", "barcode_data", "barcodeData",         // Honeywell variants
            "com.symbol.datawedge.data_string",            // Zebra DataWedge
            "com.honeywell.aidc.extra.EXTRA_BARCODE_DATA", // Honeywell AIDC
            "scanResult", "SCAN_BARCODE1", "barcode",
            "EXTRA_BARCODE_DECODING_DATA"
        )
        for (k in knownKeys) {
            intent.getStringExtra(k)?.let { if (it.isNotBlank()) return Pair(k, it) }
        }
        // Fallback: scan ALL extras for the first non-trivial string / byte[].
        val extras = intent.extras ?: return null
        for (key in extras.keySet()) {
            val v = extras.get(key)
            when (v) {
                is String -> if (v.length in 4..200 && v.any { it.isLetterOrDigit() }) return Pair(key, v)
                is ByteArray -> {
                    val s = try { String(v) } catch (e: Exception) { "" }
                    if (s.length in 4..200) return Pair("$key(bytes)", s)
                }
            }
        }
        return null
    }

    private fun extractScanData(intent: Intent): String? {
        return extractScanDataDiagnostic(intent)?.second
    }

    private fun registerScanReceiver() {
        val filter = android.content.IntentFilter().apply {
            addAction("device.scanner.event.ACTION_DATA_SCAN") // PointMobile
            addAction("com.honeywell.decode.intent.action.EDIT_DATA") // Honeywell (varies)
            addAction("com.honeywell.aidc.action.ACTION_BARCODE_READ_EVENT")
            addAction("com.symbol.datawedge.api.RESULT_ACTION") // Zebra DataWedge
            addAction("scanner.rcv.message")
            addAction("nlscan.action.SCANNER_RESULT")
        }
        try {
            if (android.os.Build.VERSION.SDK_INT >= 33) {
                registerReceiver(scanReceiver, filter, android.content.Context.RECEIVER_EXPORTED)
            } else {
                @Suppress("UnspecifiedRegisterReceiverFlag")
                registerReceiver(scanReceiver, filter)
            }
        } catch (e: Exception) {
            Log.e(TAG, "Failed to register scan receiver", e)
        }
    }

    private fun unregisterScanReceiver() {
        try { unregisterReceiver(scanReceiver) } catch (e: Exception) {}
    }

    override fun onResume() {
        super.onResume()
        registerScanReceiver()
        if (receivingModeOpen) updateHardwareScanFocus()
    }

    override fun onPause() {
        super.onPause()
        unregisterScanReceiver()
    }

    override fun onDestroy() {

        if (
            ::scanFeedbackSound.isInitialized
        ) {

            scanFeedbackSound.release()
        }

        super.onDestroy()

        barcodeScanner.close()
        cameraExecutor.shutdown()
    }

    override fun onBackPressed() {
        // If Receiving Mode is open, back should close it, not navigate PIMS.
        webView.evaluateJavascript(
            "(window.__ptx7Rx && window.__ptx7Rx.isOpen()) ? (window.__ptx7Rx.close(), 'closed') : 'none'"
        ) { result ->
            val handled = result != null && result.contains("closed")
            if (!handled) {
                if (webView.canGoBack()) {
                    webView.goBack()
                } else {
                    @Suppress("DEPRECATION")
                    super.onBackPressed()
                }
            }
        }
    }
}
