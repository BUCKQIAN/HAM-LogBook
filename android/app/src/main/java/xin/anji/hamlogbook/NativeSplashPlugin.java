package xin.anji.hamlogbook;

import android.app.Activity;
import android.content.Context;
import android.os.Build;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.Locale;

@CapacitorPlugin(name = "NativeSplash")
public class NativeSplashPlugin extends Plugin {
    private static final String PREFS_NAME = "hamlog_native_settings";
    private static final String STYLE_KEY = "startup_splash_style";

    static String getSavedStyle(Context context) {
        String value = context
            .getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .getString(STYLE_KEY, "A");
        return normalize(value);
    }

    static int getSystemSplashTheme(String style) {
        switch (normalize(style)) {
            case "B": return R.style.NativeLaunchThemeB;
            case "C": return R.style.NativeLaunchThemeC;
            case "D": return R.style.NativeLaunchThemeD;
            case "E": return R.style.NativeLaunchThemeE;
            default: return R.style.NativeLaunchThemeA;
        }
    }

    /** Android 12+ 会由系统持久保存该主题，并在下一次真正冷启动前直接使用。 */
    static boolean applySystemSplashTheme(Activity activity, String style) {
        if (activity == null || Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return false;
        activity.getSplashScreen().setSplashScreenTheme(getSystemSplashTheme(style));
        return true;
    }

    private static String normalize(String value) {
        if (value == null) return "A";
        String normalized = value.trim().toUpperCase(Locale.ROOT);
        return normalized.matches("[A-E]") ? normalized : "A";
    }

    @PluginMethod
    public void setStyle(PluginCall call) {
        String style = normalize(call.getString("style"));
        boolean saved = getContext()
            .getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .edit()
            .putString(STYLE_KEY, style)
            .commit();
        if (!saved) {
            call.reject("无法保存启动页设置");
            return;
        }

        boolean systemThemeApplied = applySystemSplashTheme(getActivity(), style);

        JSObject result = new JSObject();
        result.put("style", style);
        result.put("systemThemeApplied", systemThemeApplied);
        result.put("takesEffectNextColdStart", true);
        call.resolve(result);
    }

    @PluginMethod
    public void getStyle(PluginCall call) {
        JSObject result = new JSObject();
        result.put("style", getSavedStyle(getContext()));
        call.resolve(result);
    }

    @PluginMethod
    public void hide(PluginCall call) {
        if (getActivity() instanceof MainActivity) {
            ((MainActivity) getActivity()).hideNativeSplash();
        }
        call.resolve();
    }
}
