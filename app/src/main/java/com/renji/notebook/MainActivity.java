package com.renji.notebook;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.provider.Settings;
import android.util.Base64;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

public class MainActivity extends Activity {
    private static final int REQUEST_FILE_CHOOSER = 4101;
    private static final int REQUEST_SAVE_FILE = 4102;

    private WebView webView;
    private ValueCallback<Uri[]> filePathCallback;
    private byte[] pendingExport;
    private String pendingExportName;
    private String pendingExportMime;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        getWindow().setStatusBarColor(Color.rgb(13, 15, 18));
        getWindow().setNavigationBarColor(Color.rgb(8, 9, 11));

        webView = new WebView(this);
        setContentView(webView);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(true);
        settings.setMediaPlaybackRequiresUserGesture(true);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);

        webView.addJavascriptInterface(new AppBridge(), "AndroidBridge");
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                if (url.startsWith("tel:") || url.startsWith("sms:") || url.startsWith("mailto:")) {
                    try {
                        startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)));
                    } catch (ActivityNotFoundException error) {
                        Toast.makeText(MainActivity.this, "找不到可開啟的應用程式", Toast.LENGTH_SHORT).show();
                    }
                    return true;
                }
                if (url.startsWith("http://") || url.startsWith("https://")) {
                    startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)));
                    return true;
                }
                return false;
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView webView, ValueCallback<Uri[]> callback,
                                             FileChooserParams fileChooserParams) {
                if (filePathCallback != null) {
                    filePathCallback.onReceiveValue(null);
                }
                filePathCallback = callback;
                Intent intent = fileChooserParams.createIntent();
                try {
                    startActivityForResult(intent, REQUEST_FILE_CHOOSER);
                } catch (ActivityNotFoundException error) {
                    filePathCallback = null;
                    Toast.makeText(MainActivity.this, "無法開啟檔案選擇器", Toast.LENGTH_SHORT).show();
                    return false;
                }
                return true;
            }
        });

        webView.loadUrl("file:///android_asset/web/index.html");
    }

    @Override
    @SuppressWarnings("deprecation")
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);

        if (requestCode == REQUEST_FILE_CHOOSER) {
            Uri[] result = WebChromeClient.FileChooserParams.parseResult(resultCode, data);
            if (filePathCallback != null) {
                filePathCallback.onReceiveValue(result);
                filePathCallback = null;
            }
            return;
        }

        if (requestCode == REQUEST_SAVE_FILE) {
            if (resultCode == RESULT_OK && data != null && data.getData() != null && pendingExport != null) {
                try (OutputStream output = getContentResolver().openOutputStream(data.getData())) {
                    if (output != null) {
                        output.write(pendingExport);
                        output.flush();
                        Toast.makeText(this, "已儲存「" + pendingExportName + "」", Toast.LENGTH_SHORT).show();
                    }
                } catch (Exception error) {
                    Toast.makeText(this, "儲存失敗，請重試", Toast.LENGTH_LONG).show();
                }
            }
            pendingExport = null;
            pendingExportName = null;
            pendingExportMime = null;
        }
    }

    @Override
    public void onBackPressed() {
        webView.evaluateJavascript("window.RenjiApp && window.RenjiApp.handleBack ? window.RenjiApp.handleBack() : false", value -> {
            if (!"true".equals(value)) {
                if (webView.canGoBack()) {
                    webView.goBack();
                } else {
                    MainActivity.super.onBackPressed();
                }
            }
        });
    }

    @Override
    protected void onDestroy() {
        if (webView != null) {
            webView.removeJavascriptInterface("AndroidBridge");
            webView.destroy();
        }
        super.onDestroy();
    }

    public class AppBridge {
        @JavascriptInterface
        public String getPlatform() {
            return "android";
        }

        @JavascriptInterface
        public void saveTextFile(String fileName, String mimeType, String text) {
            pendingExport = text.getBytes(StandardCharsets.UTF_8);
            pendingExportName = sanitizeFileName(fileName);
            pendingExportMime = mimeType == null || mimeType.isEmpty() ? "application/octet-stream" : mimeType;
            launchSavePicker();
        }

        @JavascriptInterface
        public void saveBase64File(String fileName, String mimeType, String base64Data) {
            try {
                pendingExport = Base64.decode(base64Data, Base64.DEFAULT);
                pendingExportName = sanitizeFileName(fileName);
                pendingExportMime = mimeType == null || mimeType.isEmpty() ? "application/octet-stream" : mimeType;
                launchSavePicker();
            } catch (IllegalArgumentException error) {
                runOnUiThread(() -> Toast.makeText(MainActivity.this, "檔案內容無法解析", Toast.LENGTH_LONG).show());
            }
        }

        @JavascriptInterface
        public void openAppSettings() {
            runOnUiThread(() -> {
                Intent intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
                intent.setData(Uri.parse("package:" + getPackageName()));
                startActivity(intent);
            });
        }

        private void launchSavePicker() {
            runOnUiThread(() -> {
                Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                intent.setType(pendingExportMime);
                intent.putExtra(Intent.EXTRA_TITLE, pendingExportName);
                startActivityForResult(intent, REQUEST_SAVE_FILE);
            });
        }

        private String sanitizeFileName(String value) {
            if (value == null || value.trim().isEmpty()) {
                return "人際小本本備份.json";
            }
            return value.replaceAll("[\\\\/:*?\"<>|]", "_");
        }
    }
}
