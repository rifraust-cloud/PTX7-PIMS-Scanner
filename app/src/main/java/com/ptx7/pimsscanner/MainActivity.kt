package com.ptx7.pimsscanner

import android.Manifest
import android.app.Activity
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
import androidx.lifecycle.LifecycleOwner
import com.google.mlkit.vision.barcode.BarcodeScanner
import com.google.mlkit.vision.barcode.BarcodeScanning
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.common.InputImage
import org.json.JSONObject
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

class MainActivity : Activity() {

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

    private lateinit var cameraExecutor: ExecutorService
    private lateinit var barcodeScanner: BarcodeScanner

    private var lastScanValue: String = ""
    private var lastAcceptedValue: String? = null
    private var lastAcceptedTime: Long = 0L

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        previewView = findViewById(R.id.previewView)
        webView = findViewById(R.id.webView)
        lastScanText = findViewById(R.id.lastScan)
        debugText = findViewById(R.id.debugText)
        statusText = findViewById(R.id.statusText)
        pimsUrl = findViewById(R.id.pimsUrl)
        autoSubmit = findViewById(R.id.autoSubmit)

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
                    this as LifecycleOwner,
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

                    if (raw.isNotBlank() && acceptScan(raw)) {
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

    private fun acceptScan(value: String): Boolean {
        val now = SystemClock.elapsedRealtime()

        if (value == lastAcceptedValue && now - lastAcceptedTime < 1500L) {
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
        webView.settings.domStorageEnabled = true
        webView.settings.databaseEnabled = true
        webView.settings.userAgentString =
            webView.settings.userAgentString + " PTX7PimsScanner/0.3"

        CookieManager.getInstance().setAcceptCookie(true)
        CookieManager.getInstance().setAcceptThirdPartyCookies(webView, true)

        webView.webViewClient = object : WebViewClient() {
            override fun onPageFinished(view: WebView?, url: String?) {
                statusText.text = "Integrated PIMS loaded"
            }
        }

        webView.webChromeClient = WebChromeClient()
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

              let input =
                inputs.find(el =>
                    ((el.placeholder || '').toLowerCase()
                        .includes('location barcode'))
                ) ||
                inputs.find(el =>
                    ((el.getAttribute('aria-label') || '').toLowerCase()
                        .includes('location barcode'))
                ) ||
                inputs.find(el =>
                    ((el.name || '').toLowerCase()
                        .includes('location'))
                ) ||
                inputs.find(el =>
                    ((el.id || '').toLowerCase()
                        .includes('location'))
                );

              if (!input) {
                return JSON.stringify({
                    ok:false,
                    message:'Location input not found'
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
                        "Could not find the Location Barcode field"

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
