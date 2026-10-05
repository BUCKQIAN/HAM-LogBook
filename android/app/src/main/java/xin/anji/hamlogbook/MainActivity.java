package xin.anji.hamlogbook;

import android.content.pm.ApplicationInfo;
import android.content.res.Configuration;
import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.WebSettings;
import android.webkit.WebView;

import androidx.core.splashscreen.SplashScreen;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private static final long SPLASH_FALLBACK_MS = 3500L;
    private static final long SYSTEM_SPLASH_READY_FALLBACK_MS = 800L;
    private static final long SPLASH_EXIT_MS = 100L;

    private NativeSplashView nativeSplashView;
    private Handler splashHandler;
    private String splashStyle = "A";
    private String webTheme = "day";
    private boolean systemSplashReady;
    private boolean splashActive = true;
    private boolean webContentReady;
    private boolean visualStatePending;
    private boolean destroyed;
    private final Runnable splashFallback = this::releaseSplash;
    private final Runnable systemSplashReadyFallback = () -> systemSplashReady = true;
    private final Runnable splashTransitionFallback = this::finishSplashTransition;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        splashStyle = NativeSplashPlugin.getSavedStyle(this);
        webTheme = NativeSplashPlugin.getSavedTheme(this);
        splashHandler = new Handler(Looper.getMainLooper());

        // Android 12+ 的系统启动窗口已使用所选方案，不再叠加第二个启动页。
        boolean useSystemSplash = Build.VERSION.SDK_INT >= Build.VERSION_CODES.S;
        if (useSystemSplash) setTheme(NativeSplashPlugin.getSystemSplashTheme(splashStyle));
        SplashScreen systemSplash = SplashScreen.installSplashScreen(this);
        systemSplash.setKeepOnScreenCondition(() -> !systemSplashReady);
        systemSplash.setOnExitAnimationListener(provider -> {
            // Android 12/12L 的兼容库在此回调前会重设系统栏，恢复当前颜色与图标。
            applyCurrentSystemBars();
            provider.getView().animate().alpha(0f).setDuration(SPLASH_EXIT_MS)
                .withEndAction(() -> {
                    provider.remove();
                    if (useSystemSplash && webContentReady) finishSplashTransition();
                    else applyCurrentSystemBars();
                }).start();
        });

        registerPlugin(NativeSplashPlugin.class);
        registerPlugin(AdifFileManagerPlugin.class);
        registerPlugin(SecureDataPlugin.class);
        super.onCreate(savedInstanceState);
        hardenWebView();
        NativeSplashPlugin.applySystemSplashTheme(this, splashStyle);

        if (!useSystemSplash) showLegacySplash();
        applyCurrentSystemBars();
        // Capacitor 内置 SystemBars 初始化会排队重设外观，在其完成后再恢复本应用设置。
        getWindow().getDecorView().post(this::applyCurrentSystemBars);
        splashHandler.postDelayed(splashFallback, SPLASH_FALLBACK_MS);
    }

    private void showLegacySplash() {
        nativeSplashView = new NativeSplashView(this, splashStyle);
        nativeSplashView.addOnLayoutChangeListener(new View.OnLayoutChangeListener() {
            @Override
            public void onLayoutChange(View view, int left, int top, int right, int bottom,
                int oldLeft, int oldTop, int oldRight, int oldBottom) {
                if (right <= left || bottom <= top) return;
                systemSplashReady = true;
                view.removeOnLayoutChangeListener(this);
            }
        });
        addContentView(nativeSplashView, new ViewGroup.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        nativeSplashView.bringToFront();
        splashHandler.postDelayed(systemSplashReadyFallback, SYSTEM_SPLASH_READY_FALLBACK_MS);
    }

    private void hardenWebView() {
        if (getBridge() == null || getBridge().getWebView() == null) return;
        WebView webView = getBridge().getWebView();
        WebSettings settings = webView.getSettings();
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setAllowFileAccess(false);
        settings.setAllowFileAccessFromFileURLs(false);
        settings.setAllowUniversalAccessFromFileURLs(false);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) settings.setSafeBrowsingEnabled(true);
        boolean isDebuggable = (getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0;
        WebView.setWebContentsDebuggingEnabled(isDebuggable);
    }

    public void setWebTheme(String theme) {
        webTheme = "night".equals(theme) ? "night" : "day";
        // 启动期间保持启动方案的外观，页面显示后才切换到网页主题。
        applyCurrentSystemBars();
    }

    public void hideNativeSplash() {
        runOnUiThread(() -> {
            if (destroyed || webContentReady || visualStatePending) return;
            if (getBridge() == null || getBridge().getWebView() == null) {
                releaseSplash();
                return;
            }
            WebView webView = getBridge().getWebView();
            if (!webView.isAttachedToWindow() || webView.getVisibility() != View.VISIBLE) return;
            visualStatePending = true;
            // 确认调用时的 DOM 已可绘制，而不是用固定停留时间推测网页是否就绪。
            webView.postVisualStateCallback(0L, new WebView.VisualStateCallback() {
                @Override
                public void onComplete(long requestId) {
                    if (!destroyed) releaseSplash();
                }
            });
        });
    }

    private void releaseSplash() {
        if (destroyed || webContentReady) return;
        webContentReady = true;
        systemSplashReady = true;
        splashHandler.removeCallbacks(systemSplashReadyFallback);
        splashHandler.removeCallbacks(splashFallback);
        getWindow().getDecorView().invalidate();

        if (nativeSplashView != null) {
            NativeSplashView view = nativeSplashView;
            nativeSplashView = null;
            view.animate().alpha(0f).setDuration(SPLASH_EXIT_MS).withEndAction(() -> {
                ViewGroup parent = (ViewGroup) view.getParent();
                if (parent != null) parent.removeView(view);
                finishSplashTransition();
            }).start();
        } else {
            // 某些热恢复/启动来源不展示系统启动页，也就不会触发退出监听。
            splashHandler.postDelayed(splashTransitionFallback, SPLASH_EXIT_MS + 150L);
        }
    }

    private void finishSplashTransition() {
        if (destroyed) return;
        splashHandler.removeCallbacks(splashTransitionFallback);
        splashActive = false;
        applyCurrentSystemBars();
    }

    @SuppressWarnings("deprecation")
    private void applyCurrentSystemBars() {
        if (destroyed) return;
        boolean dark = splashActive ? "D".equals(splashStyle) : "night".equals(webTheme);
        int background = splashActive ? NativeSplashView.getBackgroundColor(splashStyle)
            : dark ? Color.rgb(36, 33, 31) : Color.rgb(243, 239, 232);
        getWindow().setStatusBarColor(background);
        getWindow().setNavigationBarColor(background);
        // Android 15+ 系统栏透明，必须同时提供栏后面的窗口背景。
        getWindow().getDecorView().setBackgroundColor(background);
        if (getBridge() != null && getBridge().getWebView() != null) {
            getBridge().getWebView().setBackgroundColor("night".equals(webTheme)
                ? Color.rgb(36, 33, 31) : Color.rgb(243, 239, 232));
        }
        WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(
            getWindow(), getWindow().getDecorView());
        controller.setAppearanceLightStatusBars(!dark);
        controller.setAppearanceLightNavigationBars(!dark);
    }

    @Override
    public void onConfigurationChanged(Configuration newConfig) {
        super.onConfigurationChanged(newConfig);
        webTheme = NativeSplashPlugin.getSavedTheme(this);
        applyCurrentSystemBars();
        getWindow().getDecorView().post(this::applyCurrentSystemBars);
    }

    @Override
    public void onResume() {
        super.onResume();
        webTheme = NativeSplashPlugin.getSavedTheme(this);
        applyCurrentSystemBars();
        getWindow().getDecorView().post(this::applyCurrentSystemBars);
    }

    @Override
    public void onDestroy() {
        destroyed = true;
        if (splashHandler != null) splashHandler.removeCallbacksAndMessages(null);
        super.onDestroy();
    }
}
