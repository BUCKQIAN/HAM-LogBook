package xin.anji.hamlogbook;

import android.content.Context;

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

    private static String normalize(String value) {
        if (value == null) return "A";
        String normalized = value.trim().toUpperCase(Locale.ROOT);
        return normalized.matches("[A-E]") ? normalized : "A";
    }

    @PluginMethod
    public void setStyle(PluginCall call) {
        String style = normalize(call.getString("style"));
        getContext()
            .getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .edit()
            .putString(STYLE_KEY, style)
            .apply();

        JSObject result = new JSObject();
        result.put("style", style);
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
