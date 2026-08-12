package xin.anji.hamlogbook;

import android.annotation.SuppressLint;
import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.os.StatFs;
import android.util.Base64;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONObject;

import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/**
 * 只保存本应用定义的少量敏感数据。密文位于应用私有 SharedPreferences，
 * AES 密钥不可导出并由 Android Keystore 持有。
 */
@CapacitorPlugin(name = "SecureData")
public class SecureDataPlugin extends Plugin {
    private static final String KEYSTORE = "AndroidKeyStore";
    private static final String KEY_ALIAS = "hamlog_secure_data_key_v1";
    private static final String PREFS_NAME = "hamlog_secure_data_v1";
    private static final String CREDENTIALS_KEY = "hamqth_credentials";
    private static final String DRAFT_KEY = "qso_draft";
    private static final int GCM_TAG_BITS = 128;
    private static final int IV_LENGTH = 12;
    private static final int MAX_DRAFT_BYTES = 256 * 1024;

    @PluginMethod
    public void getHamQthCredentials(PluginCall call) {
        try {
            String stored = readEncrypted(CREDENTIALS_KEY);
            JSObject result = new JSObject();
            if (stored.isEmpty()) {
                result.put("username", "");
                result.put("password", "");
            } else {
                JSONObject credentials = new JSONObject(stored);
                result.put("username", credentials.optString("username", ""));
                result.put("password", credentials.optString("password", ""));
            }
            call.resolve(result);
        } catch (Exception error) {
            call.reject("无法读取安全凭据；请在设置中重新保存 HamQTH 账号", error);
        }
    }

    @PluginMethod
    public void setHamQthCredentials(PluginCall call) {
        String username = call.getString("username", "").trim();
        String password = call.getString("password", "");
        if (username.length() > 128 || password.length() > 1024) {
            call.reject("HamQTH 账号或密码过长");
            return;
        }
        try {
            if (username.isEmpty() || password.isEmpty()) {
                remove(CREDENTIALS_KEY);
            } else {
                JSONObject credentials = new JSONObject();
                credentials.put("username", username);
                credentials.put("password", password);
                writeEncrypted(CREDENTIALS_KEY, credentials.toString());
            }
            call.resolve();
        } catch (Exception error) {
            call.reject("无法安全保存 HamQTH 凭据", error);
        }
    }

    @PluginMethod
    public void getDraft(PluginCall call) {
        try {
            JSObject result = new JSObject();
            result.put("data", readEncrypted(DRAFT_KEY));
            call.resolve(result);
        } catch (Exception error) {
            call.reject("无法读取加密草稿", error);
        }
    }

    @PluginMethod
    public void setDraft(PluginCall call) {
        String data = call.getString("data");
        if (data == null) {
            call.reject("草稿内容为空");
            return;
        }
        if (data.getBytes(StandardCharsets.UTF_8).length > MAX_DRAFT_BYTES) {
            call.reject("草稿内容过大");
            return;
        }
        try {
            writeEncrypted(DRAFT_KEY, data);
            call.resolve();
        } catch (Exception error) {
            call.reject("无法安全保存草稿", error);
        }
    }

    @PluginMethod
    public void clearDraft(PluginCall call) {
        try {
            remove(DRAFT_KEY);
            call.resolve();
        } catch (Exception error) {
            call.reject("无法清除加密草稿", error);
        }
    }

    @PluginMethod
    public void getStorageInfo(PluginCall call) {
        StatFs stats = new StatFs(getContext().getFilesDir().getAbsolutePath());
        JSObject result = new JSObject();
        result.put("availableBytes", stats.getAvailableBytes());
        result.put("totalBytes", stats.getTotalBytes());
        call.resolve(result);
    }

    private SharedPreferences preferences() {
        return getContext().getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
    }

    private SecretKey getOrCreateKey() throws Exception {
        KeyStore keyStore = KeyStore.getInstance(KEYSTORE);
        keyStore.load(null);
        KeyStore.Entry entry = keyStore.getEntry(KEY_ALIAS, null);
        if (entry instanceof KeyStore.SecretKeyEntry) {
            return ((KeyStore.SecretKeyEntry) entry).getSecretKey();
        }

        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE);
        generator.init(new KeyGenParameterSpec.Builder(
            KEY_ALIAS,
            KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT
        )
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(256)
            .build());
        return generator.generateKey();
    }

    private void writeEncrypted(String key, String plaintext) throws Exception {
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, getOrCreateKey());
        byte[] iv = cipher.getIV();
        byte[] ciphertext = cipher.doFinal(plaintext.getBytes(StandardCharsets.UTF_8));
        ByteBuffer payload = ByteBuffer.allocate(1 + iv.length + ciphertext.length);
        payload.put((byte) iv.length);
        payload.put(iv);
        payload.put(ciphertext);
        boolean saved = preferences().edit()
            .putString(key, Base64.encodeToString(payload.array(), Base64.NO_WRAP))
            .commit();
        if (!saved) throw new IllegalStateException("安全存储写入失败");
    }

    private String readEncrypted(String key) throws Exception {
        String encoded = preferences().getString(key, "");
        if (encoded == null || encoded.isEmpty()) return "";
        byte[] payload = Base64.decode(encoded, Base64.NO_WRAP);
        if (payload.length <= 1) throw new IllegalStateException("安全存储数据损坏");
        ByteBuffer buffer = ByteBuffer.wrap(payload);
        int ivLength = buffer.get() & 0xff;
        if (ivLength != IV_LENGTH || buffer.remaining() <= ivLength) {
            throw new IllegalStateException("安全存储数据损坏");
        }
        byte[] iv = new byte[ivLength];
        buffer.get(iv);
        byte[] ciphertext = new byte[buffer.remaining()];
        buffer.get(ciphertext);

        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE, getOrCreateKey(), new GCMParameterSpec(GCM_TAG_BITS, iv));
        return new String(cipher.doFinal(ciphertext), StandardCharsets.UTF_8);
    }

    @SuppressLint("ApplySharedPref")
    private void remove(String key) {
        // 必须确认敏感数据已经从磁盘删除后再向网页端报告成功。
        if (!preferences().edit().remove(key).commit()) {
            throw new IllegalStateException("安全存储删除失败");
        }
    }
}
