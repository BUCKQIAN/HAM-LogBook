package xin.anji.hamlogbook;

import android.content.pm.ApplicationInfo;
import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.WebSettings;
import android.webkit.WebView;

import androidx.core.splashscreen.SplashScreen;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private static final long SPLASH_FALLBACK_MS = 3500L;
    private static final long SYSTEM_SPLASH_READY_FALLBACK_MS = 800L;
    private static final long MIN_SELECTED_SPLASH_MS = 1000L;

    private NativeSplashView nativeSplashView;
    private Handler splashHandler;
    private boolean systemSplashReady;
    private boolean splashHideScheduled;
    private long selectedSplashShownAtMs;
    private final Runnable splashFallback = this::hideNativeSplash;
    private final Runnable systemSplashReadyFallback = () -> systemSplashReady = true;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        String style = NativeSplashPlugin.getSavedStyle(this);

        // 系统先显示启动窗口，NativeSplashView 再保证所有 Android 版本都能看到用户所选方案。
        SplashScreen systemSplash = SplashScreen.installSplashScreen(this);
        systemSplash.setKeepOnScreenCondition(() -> !systemSplashReady);
        systemSplash.setOnExitAnimationListener(provider ->
            provider.getView().animate()
                .alpha(0f)
                .setDuration(100L)
                .withEndAction(provider::remove)
                .start()
        );

        // 自定义插件必须在 Bridge 创建前注册。
        registerPlugin(NativeSplashPlugin.class);
        registerPlugin(AdifFileManagerPlugin.class);
        registerPlugin(SecureDataPlugin.class);
        super.onCreate(savedInstanceState);
        hardenWebView();
        splashHandler = new Handler(Looper.getMainLooper());

        // 修复系统主题记录与本地设置不一致的情况；当前冷启动已显示，下一次生效。
        NativeSplashPlugin.applySystemSplashTheme(this, style);
        int background = NativeSplashView.getBackgroundColor(style);
        configureSystemBars(style, background);

        nativeSplashView = new NativeSplashView(this, style);
        selectedSplashShownAtMs = SystemClock.uptimeMillis();
        nativeSplashView.addOnLayoutChangeListener(new View.OnLayoutChangeListener() {
            @Override
            public void onLayoutChange(
                View view,
                int left,
                int top,
                int right,
                int bottom,
                int oldLeft,
                int oldTop,
                int oldRight,
                int oldBottom
            ) {
                if (right <= left || bottom <= top) return;
                systemSplashReady = true;
                view.removeOnLayoutChangeListener(this);
            }
        });
        addContentView(
            nativeSplashView,
            new ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            )
        );
        nativeSplashView.bringToFront();

        // 网页会在首帧绘制后主动关闭；此超时仅防止异常时遮住应用。
        splashHandler.postDelayed(systemSplashReadyFallback, SYSTEM_SPLASH_READY_FALLBACK_MS);
        splashHandler.postDelayed(splashFallback, SPLASH_FALLBACK_MS);
    }

    private void hardenWebView() {
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

    public void hideNativeSplash() {
        runOnUiThread(() -> {
            if (splashHandler != null) {
                splashHandler.removeCallbacks(systemSplashReadyFallback);
                splashHandler.removeCallbacks(splashFallback);
            }
            systemSplashReady = true;

            // 网页很快就绪时仍至少展示一秒用户方案，避免只闪过一帧。
            if (nativeSplashView != null && splashHandler != null) {
                long elapsed = SystemClock.uptimeMillis() - selectedSplashShownAtMs;
                long remaining = MIN_SELECTED_SPLASH_MS - elapsed;
                if (remaining > 0L) {
                    if (!splashHideScheduled) {
                        splashHideScheduled = true;
                        splashHandler.postDelayed(splashFallback, remaining);
                    }
                    return;
                }
            }
            splashHideScheduled = false;

            if (nativeSplashView == null) {
                restoreSystemBars();
                return;
            }

            NativeSplashView view = nativeSplashView;
            nativeSplashView = null;
            view.animate()
                .alpha(0f)
                .setDuration(220L)
                .withEndAction(() -> {
                    ViewGroup parent = (ViewGroup) view.getParent();
                    if (parent != null) parent.removeView(view);
                    restoreSystemBars();
                })
                .start();
        });
    }

    private void configureSystemBars(String style, int color) {
        getWindow().setStatusBarColor(color);
        getWindow().setNavigationBarColor(color);
        int flags = getWindow().getDecorView().getSystemUiVisibility();
        boolean light = !"D".equals(style);
        flags = light ? flags | View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR
            : flags & ~View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            flags = light ? flags | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR
                : flags & ~View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
        }
        getWindow().getDecorView().setSystemUiVisibility(flags);
    }

    private void restoreSystemBars() {
        int paper = Color.rgb(243, 239, 232);
        configureSystemBars("A", paper);
    }

    @Override
    public void onDestroy() {
        if (splashHandler != null) {
            splashHandler.removeCallbacks(systemSplashReadyFallback);
            splashHandler.removeCallbacks(splashFallback);
        }
        super.onDestroy();
    }
}
