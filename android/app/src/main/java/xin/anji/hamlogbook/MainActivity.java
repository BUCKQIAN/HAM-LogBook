package xin.anji.hamlogbook;

import android.Manifest;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.View;
import android.view.ViewGroup;

import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import androidx.core.splashscreen.SplashScreen;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private static final long SPLASH_FALLBACK_MS = 3500L;
    private static final int PERMISSION_REQUEST_CODE = 1001;

    private NativeSplashView nativeSplashView;
    private Handler splashHandler;
    private final Runnable splashFallback = this::hideNativeSplash;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        // 正确接管 Android 12+ 系统启动窗口，并在旧系统上使用兼容实现。
        SplashScreen.installSplashScreen(this);
        // 自定义插件必须在 Bridge 创建前注册，设置页才能写入原生启动页偏好。
        registerPlugin(NativeSplashPlugin.class);
        super.onCreate(savedInstanceState);

        // 应用启动即申请权限（存储 + 定位），避免使用中途才弹窗
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            requestAppPermissions();
        }

        String style = NativeSplashPlugin.getSavedStyle(this);
        int background = NativeSplashView.getBackgroundColor(style);
        configureSystemBars(style, background);

        nativeSplashView = new NativeSplashView(this, style);
        addContentView(
            nativeSplashView,
            new ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            )
        );
        nativeSplashView.bringToFront();

        // 网页会在首帧绘制后主动关闭；此超时仅防止异常时遮住应用。
        splashHandler = new Handler(Looper.getMainLooper());
        splashHandler.postDelayed(splashFallback, SPLASH_FALLBACK_MS);
    }

    public void hideNativeSplash() {
        runOnUiThread(() -> {
            if (nativeSplashView == null) return;
            if (splashHandler != null) splashHandler.removeCallbacks(splashFallback);

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

    /** 启动时一次性申请运行时权限：读写存储 + 定位 */
    private void requestAppPermissions() {
        String[] permissions = {
            Manifest.permission.READ_EXTERNAL_STORAGE,
            Manifest.permission.WRITE_EXTERNAL_STORAGE,
            Manifest.permission.ACCESS_FINE_LOCATION,
            Manifest.permission.ACCESS_COARSE_LOCATION
        };
        boolean needRequest = false;
        for (String perm : permissions) {
            if (ContextCompat.checkSelfPermission(this, perm) != PackageManager.PERMISSION_GRANTED) {
                needRequest = true;
                break;
            }
        }
        if (needRequest) {
            ActivityCompat.requestPermissions(this, permissions, PERMISSION_REQUEST_CODE);
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        // 用户拒绝时静默继续，后续功能调用时 Capacitor 会再次引导开启
    }

    private void configureSystemBars(String style, int color) {
        getWindow().setStatusBarColor(color);
        getWindow().setNavigationBarColor(color);
        int flags = getWindow().getDecorView().getSystemUiVisibility();
        boolean light = !"D".equals(style);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            flags = light ? flags | View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR
                : flags & ~View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
        }
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
        if (splashHandler != null) splashHandler.removeCallbacks(splashFallback);
        super.onDestroy();
    }
}
