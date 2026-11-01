package com.prospectai.android;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.net.http.SslError;
import android.os.Build;
import android.os.Bundle;
import android.os.SystemClock;
import android.view.Gravity;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.webkit.CookieManager;
import android.webkit.PermissionRequest;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.SslErrorHandler;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;

import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;

import org.json.JSONObject;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public final class MainActivity extends Activity {
    private static final int SAVE_EXPORT = 41;
    private static final int BACKGROUND = Color.rgb(3, 18, 31);
    private static final int ACCENT = Color.rgb(0, 219, 235);
    private final NavigationPolicy policy = new NavigationPolicy(BuildConfig.APP_URL);
    private final ExecutorService files = Executors.newSingleThreadExecutor();
    private WebView web;
    private FrameLayout root;
    private LinearLayout state;
    private ProgressBar progress;
    private byte[] pendingExport;
    private long lastBack;
    private boolean failed;
    private String exportScript;

    @Override public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        if (Build.VERSION.SDK_INT >= 30) {
            getWindow().setDecorFitsSystemWindows(false);
            WindowInsetsController controller = getWindow().getInsetsController();
            if (controller != null) controller.setSystemBarsAppearance(0,
                WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS | WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS);
        } else {
            getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_LAYOUT_STABLE |
                View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION);
        }
        root = new FrameLayout(this);
        root.setBackgroundColor(BACKGROUND);
        root.setOnApplyWindowInsetsListener((view, insets) -> {
            if (Build.VERSION.SDK_INT >= 30) {
                android.graphics.Insets bars = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
                android.graphics.Insets ime = insets.getInsets(WindowInsets.Type.ime());
                view.setPadding(bars.left, bars.top, bars.right, Math.max(bars.bottom, ime.bottom));
                return WindowInsets.CONSUMED;
            }
            view.setPadding(insets.getSystemWindowInsetLeft(), insets.getSystemWindowInsetTop(),
                insets.getSystemWindowInsetRight(), insets.getSystemWindowInsetBottom());
            return insets.consumeSystemWindowInsets();
        });
        setContentView(root);
        configureWebView();
        progress = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        progress.setProgressTintList(android.content.res.ColorStateList.valueOf(ACCENT));
        progress.setContentDescription(getString(R.string.loading));
        root.addView(progress, new FrameLayout.LayoutParams(-1, dp(3), Gravity.TOP));
        showState(false);
        web.loadUrl(BuildConfig.APP_URL);
        if (Build.VERSION.SDK_INT >= 33) {
            getOnBackInvokedDispatcher().registerOnBackInvokedCallback(
                android.window.OnBackInvokedDispatcher.PRIORITY_DEFAULT, this::handleBack);
        }
    }

    private void configureWebView() {
        web = new WebView(this);
        web.setBackgroundColor(BACKGROUND);
        root.addView(web, new FrameLayout.LayoutParams(-1, -1));
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setAllowFileAccessFromFileURLs(false);
        settings.setAllowUniversalAccessFromFileURLs(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setSafeBrowsingEnabled(true);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        // target=_blank is treated as navigation and still checked by the policy.
        settings.setSupportMultipleWindows(false);
        settings.setMediaPlaybackRequiresUserGesture(true);
        settings.setSaveFormData(false);
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, false);
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG);
        configureExports();
        web.setWebChromeClient(new WebChromeClient() {
            @Override public void onProgressChanged(WebView view, int value) {
                if (progress == null) return;
                progress.setProgress(value);
                progress.setVisibility(value == 100 ? View.GONE : View.VISIBLE);
            }
            @Override public void onPermissionRequest(PermissionRequest request) { request.deny(); }
        });
        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                if (policy.internal(request.getUrl().toString())) return false;
                if (request.isForMainFrame()) routeExternal(request.getUrl().toString());
                return true;
            }
            @Override public void onPageStarted(WebView view, String url, android.graphics.Bitmap icon) {
                if (!policy.internal(url)) { view.stopLoading(); showState(true); return; }
                failed = false;
            }
            @Override public void onPageCommitVisible(WebView view, String url) {
                if (!failed && policy.internal(url)) hideState();
            }
            @Override public void onPageFinished(WebView view, String url) {
                if (!failed && policy.internal(url)) {
                    hideState();
                    if (exportScript != null) view.evaluateJavascript(exportScript, null);
                    CookieManager.getInstance().flush();
                }
            }
            @Override public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) showState(true);
            }
            @Override public void onReceivedHttpError(WebView view, WebResourceRequest request, WebResourceResponse response) {
                if (request.isForMainFrame() && response.getStatusCode() >= 400) showState(true);
            }
            @Override public void onReceivedSslError(WebView view, SslErrorHandler handler, SslError error) {
                handler.cancel();
                if (view.getUrl() != null && view.getUrl().equals(error.getUrl())) showState(true);
            }
            @Override public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
                root.removeView(view); view.destroy(); web = null; showState(true); return true;
            }
        });
        web.setDownloadListener((url, agent, disposition, mime, length) -> {
            if (policy.internal(url)) openBrowser(url);
            else if (policy.destination(url) == NavigationPolicy.Destination.BROWSER) routeExternal(url);
            else exportFallback();
        });
    }

    private void configureExports() {
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) return;
        try (java.io.InputStream stream = getAssets().open("export-bridge.js")) {
            java.io.ByteArrayOutputStream buffer = new java.io.ByteArrayOutputStream();
            byte[] block = new byte[4096]; int count;
            while ((count = stream.read(block)) != -1) buffer.write(block, 0, count);
            exportScript = buffer.toString(StandardCharsets.UTF_8.name());
        } catch (java.io.IOException error) { return; }
        // Origin scoped messaging; no addJavascriptInterface, file access or wildcard origins.
        WebViewCompat.addWebMessageListener(web, "ProspectAndroid", Collections.singleton(policy.origin()),
            (view, message, sourceOrigin, mainFrame, reply) -> {
                if (!mainFrame || !policy.internal(sourceOrigin.toString()) || !policy.internal(view.getUrl())) return;
                String payload;
                try { payload = message.getData(); } catch (RuntimeException error) { return; }
                if (payload == null || payload.length() > 16 * 1024 * 1024) return;
                try {
                    JSONObject data = new JSONObject(payload);
                    if ("export-error".equals(data.optString("type"))) { exportFallback(); return; }
                    if (!"export".equals(data.optString("type"))) return;
                    if (pendingExport != null) { toast(R.string.export_busy); return; }
                    String name = data.getString("name"), mime = data.getString("mime");
                    if (!name.matches("prospect-ai(?:-parcial)?-[0-9]+\\.(csv|json)")) return;
                    if (!(name.endsWith(".csv") && mime.equals("text/csv") ||
                            name.endsWith(".json") && mime.equals("application/json"))) return;
                    byte[] bytes = data.getString("text").getBytes(StandardCharsets.UTF_8);
                    if (bytes.length > 8 * 1024 * 1024) { exportFallback(); return; }
                    pendingExport = bytes;
                    Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE)
                        .setType(mime).putExtra(Intent.EXTRA_TITLE, name);
                    try { startActivityForResult(intent, SAVE_EXPORT); }
                    catch (ActivityNotFoundException error) { pendingExport = null; exportFallback(); }
                } catch (org.json.JSONException error) { /* Reject unrecognised messages without logging content. */ }
            });
        if (WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT))
            WebViewCompat.addDocumentStartJavaScript(web, exportScript, Collections.singleton(policy.origin()));
    }

    @Override protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data);
        if (request != SAVE_EXPORT) return;
        byte[] bytes = pendingExport; pendingExport = null;
        if (result != RESULT_OK) return;
        Uri target = data == null ? null : data.getData();
        if (bytes == null || target == null || !"content".equals(target.getScheme())) { toast(R.string.export_failed); return; }
        files.execute(() -> {
            boolean saved = false;
            try (OutputStream stream = getContentResolver().openOutputStream(target, "wt")) {
                if (stream == null) throw new java.io.IOException();
                stream.write(bytes); saved = true;
            } catch (java.io.IOException | SecurityException error) { /* No customer data in logs. */ }
            final boolean complete = saved;
            runOnUiThread(() -> { if (!isDestroyed()) toast(complete ? R.string.export_saved : R.string.export_failed); });
        });
    }

    private void routeExternal(String url) {
        NavigationPolicy.Destination destination = policy.destination(url);
        String target = policy.externalUrl(url);
        if (target == null) { toast(R.string.blocked_link); return; }
        String action = destination == NavigationPolicy.Destination.DIALER ? Intent.ACTION_DIAL :
            destination == NavigationPolicy.Destination.EMAIL ? Intent.ACTION_SENDTO : Intent.ACTION_VIEW;
        Intent intent = new Intent(action, Uri.parse(target));
        if (destination == NavigationPolicy.Destination.BROWSER || destination == NavigationPolicy.Destination.WHATSAPP)
            intent.addCategory(Intent.CATEGORY_BROWSABLE);
        try { startActivity(intent); }
        catch (ActivityNotFoundException error) { toast(R.string.no_handler); }
    }

    private void openBrowser(String url) {
        if (!policy.internal(url)) return;
        try { startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)).addCategory(Intent.CATEGORY_BROWSABLE)); }
        catch (ActivityNotFoundException error) { toast(R.string.no_handler); }
    }

    private void exportFallback() {
        if (isFinishing() || isDestroyed()) return;
        new AlertDialog.Builder(this).setMessage(R.string.export_failed)
            .setPositiveButton(R.string.open_browser, (dialog, button) -> openBrowser(BuildConfig.APP_URL))
            .setNegativeButton(android.R.string.cancel, null).show();
    }

    private void showState(boolean error) {
        failed = error;
        if (state != null) root.removeView(state);
        state = new LinearLayout(this); state.setOrientation(LinearLayout.VERTICAL);
        state.setGravity(Gravity.CENTER); state.setPadding(dp(28), dp(28), dp(28), dp(28));
        state.setBackgroundColor(BACKGROUND);
        ImageView logo = new ImageView(this); logo.setImageResource(R.drawable.ic_logo);
        logo.setContentDescription(getString(R.string.app_name)); state.addView(logo, new LinearLayout.LayoutParams(dp(68), dp(68)));
        TextView title = new TextView(this); title.setText(error ? R.string.error_title : R.string.app_name);
        title.setTextColor(Color.WHITE); title.setTextSize(24); title.setGravity(Gravity.CENTER);
        title.setPadding(0, dp(20), 0, dp(12)); state.addView(title);
        TextView subtitle = new TextView(this); subtitle.setText(error ? R.string.error_message : R.string.loading);
        subtitle.setTextColor(Color.rgb(165, 186, 204)); subtitle.setTextSize(16); subtitle.setGravity(Gravity.CENTER); state.addView(subtitle);
        if (error) {
            Button retry = new Button(this); retry.setText(R.string.retry);
            retry.setOnClickListener(view -> {
                if (web == null) { recreate(); return; }
                showState(false); web.loadUrl(policy.internal(web.getUrl()) ? web.getUrl() : BuildConfig.APP_URL);
            }); state.addView(retry);
            Button browser = new Button(this); browser.setText(R.string.open_browser);
            browser.setOnClickListener(view -> openBrowser(BuildConfig.APP_URL)); state.addView(browser);
        }
        root.addView(state, new FrameLayout.LayoutParams(-1, -1));
    }

    private void hideState() { if (state != null) { root.removeView(state); state = null; } }
    private int dp(int value) { return Math.round(value * getResources().getDisplayMetrics().density); }
    private void toast(int message) { Toast.makeText(this, message, Toast.LENGTH_SHORT).show(); }
    private void handleBack() {
        if (web != null && web.canGoBack()) { web.goBack(); return; }
        long now = SystemClock.elapsedRealtime();
        if (now - lastBack < 2000) finish();
        else { lastBack = now; toast(R.string.exit_hint); }
    }
    @Override public void onBackPressed() { handleBack(); }
    @Override protected void onPause() {
        if (web != null) web.onPause();
        CookieManager.getInstance().flush(); super.onPause();
    }
    @Override protected void onResume() { super.onResume(); if (web != null) web.onResume(); }
    @Override protected void onDestroy() {
        pendingExport = null;
        if (web != null) { root.removeView(web); web.destroy(); web = null; }
        files.shutdown(); super.onDestroy();
    }
}
