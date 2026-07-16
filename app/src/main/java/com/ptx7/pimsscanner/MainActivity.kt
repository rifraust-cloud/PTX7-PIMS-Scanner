package com.ptx7.pimsscanner

import android.app.Activity
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Bundle
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
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.codescanner.GmsBarcodeScannerOptions
import com.google.mlkit.vision.codescanner.GmsBarcodeScanning
import org.json.JSONObject

class MainActivity : Activity() {

    private lateinit var webView: WebView
    private lateinit var lastScanText: TextView
    private lateinit var statusText: TextView
    private lateinit var pimsUrl: EditText
    private lateinit var autoSubmit: CheckBox

    private var lastScanValue: String = ""

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        webView = findViewById(R.id.webView)
        lastScanText = findViewById(R.id.lastScan)
        statusText = findViewById(R.id.statusText)
        pimsUrl = findViewById(R.id.pimsUrl)
        autoSubmit = findViewById(R.id.autoSubmit)

        configureWebView()

        findViewById<Button>(R.id.scanButton).setOnClickListener { scanCode() }
        findViewById<Button>(R.id.copyButton).setOnClickListener { copyLastScan() }
        findViewById<Button>(R.id.openChromeButton).setOnClickListener { openPimsExternally() }
        findViewById<Button>(R.id.loadIntegratedButton).setOnClickListener { loadIntegratedPims() }
        findViewById<Button>(R.id.sendToPageButton).setOnClickListener { sendLastScanToPage(submit = true) }
    }

    private fun configureWebView() {
        webView.settings.javaScriptEnabled = true
        webView.settings.domStorageEnabled = true
        webView.settings.databaseEnabled = true
        webView.settings.userAgentString = webView.settings.userAgentString + " PTX7PimsScanner/0.1"

        CookieManager.getInstance().setAcceptCookie(true)
        CookieManager.getInstance().setAcceptThirdPartyCookies(webView, true)

        webView.webViewClient = object : WebViewClient() {
            override fun onPageFinished(view: WebView?, url: String?) {
                statusText.text = "Integrated PIMS loaded"
            }
        }
        webView.webChromeClient = WebChromeClient()
    }

    private fun scanCode() {
        val options = GmsBarcodeScannerOptions.Builder()
            .build()

        val scanner = GmsBarcodeScanning.getClient(this, options)
        statusText.text = "Scanning…"

        scanner.startScan()
            .addOnSuccessListener { barcode ->
                val raw = barcode.rawValue?.trim().orEmpty()
                if (raw.isBlank()) {
                    statusText.text = "Barcode had no readable value"
                    return@addOnSuccessListener
                }

                lastScanValue = raw
                lastScanText.text = raw
                copyToClipboard(raw)
                statusText.text = "Scanned and copied"

                if (autoSubmit.isChecked) {
                    sendLastScanToPage(submit = true)
                }
            }
            .addOnCanceledListener {
                statusText.text = "Scan canceled"
            }
            .addOnFailureListener { e ->
                statusText.text = "Scan failed: ${e.message ?: "Unknown error"}"
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
        val clipboard = getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
        clipboard.setPrimaryClip(ClipData.newPlainText("PIMS location", value))
    }

    private fun openPimsExternally() {
        val url = pimsUrl.text.toString().trim()
        if (url.isBlank()) {
            toast("Enter the PIMS URL first")
            return
        }
        startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)))
    }

    private fun loadIntegratedPims() {
        val url = pimsUrl.text.toString().trim()
        if (url.isBlank()) {
            toast("Enter the PIMS URL first")
            return
        }
        statusText.text = "Loading integrated PIMS…"
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
                return s.display !== 'none' && s.visibility !== 'hidden' && r.width > 0 && r.height > 0;
              }

              const inputs = Array.from(document.querySelectorAll('input, textarea')).filter(visible);

              let input =
                inputs.find(el => ((el.placeholder || '').toLowerCase().includes('location barcode'))) ||
                inputs.find(el => ((el.getAttribute('aria-label') || '').toLowerCase().includes('location barcode'))) ||
                inputs.find(el => ((el.name || '').toLowerCase().includes('location'))) ||
                inputs.find(el => ((el.id || '').toLowerCase().includes('location')));

              if (!input) {
                return JSON.stringify({ok:false, message:'Location input not found'});
              }

              input.focus();

              const proto = input.tagName === 'TEXTAREA'
                ? window.HTMLTextAreaElement.prototype
                : window.HTMLInputElement.prototype;
              const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
              setter.call(input, scanValue);

              input.dispatchEvent(new Event('input', {bubbles:true}));
              input.dispatchEvent(new Event('change', {bubbles:true}));

              if (shouldSubmit) {
                const buttons = Array.from(document.querySelectorAll('button, input[type=submit]')).filter(visible);
                const submitButton = buttons.find(b => {
                  const txt = (b.innerText || b.value || b.getAttribute('aria-label') || '').trim().toLowerCase();
                  return txt === 'submit' || txt.includes('submit');
                });

                if (submitButton) {
                  submitButton.click();
                  return JSON.stringify({ok:true, message:'Value entered and Submit clicked'});
                }

                input.dispatchEvent(new KeyboardEvent('keydown', {
                  key:'Enter', code:'Enter', keyCode:13, which:13, bubbles:true
                }));
                input.dispatchEvent(new KeyboardEvent('keyup', {
                  key:'Enter', code:'Enter', keyCode:13, which:13, bubbles:true
                }));
                return JSON.stringify({ok:true, message:'Value entered; Enter key event sent'});
              }

              return JSON.stringify({ok:true, message:'Value entered'});
            })();
        """.trimIndent()

        webView.evaluateJavascript(js) { result ->
            statusText.text = when {
                result.contains("Location input not found", ignoreCase = true) ->
                    "Could not find the Location Barcode field on this page"
                result.contains("Submit clicked", ignoreCase = true) ->
                    "Sent $lastScanValue and clicked Submit"
                result.contains("Enter key event", ignoreCase = true) ->
                    "Sent $lastScanValue and attempted Enter"
                else ->
                    "Sent $lastScanValue to integrated PIMS"
            }
        }
    }

    private fun toast(message: String) {
        Toast.makeText(this, message, Toast.LENGTH_SHORT).show()
    }

    override fun onBackPressed() {
        if (webView.canGoBack()) {
            webView.goBack()
        } else {
            super.onBackPressed()
        }
    }
}
