/* ============================================================
   secure-data.js - Android Keystore 安全数据桥接
   Android 使用 SecureData 原生插件；浏览器预览仅使用会话存储，关闭后失效。
   ============================================================ */

const LEGACY_USER_KEY = 'hamlog_hamqth_user';
const LEGACY_PASSWORD_KEY = 'hamlog_hamqth_pass';
const USER_HINT_KEY = 'hamlog_hamqth_user_hint';
const LEGACY_DRAFT_KEY = 'hamlog_qso_draft_v1';
const WEB_CREDENTIALS_KEY = 'hamlog_session_hamqth_credentials';
const WEB_DRAFT_KEY = 'hamlog_session_qso_draft';

function securePlugin() {
  return window.Capacitor?.Plugins?.SecureData || null;
}

function purgeLegacyCredentials() {
  localStorage.removeItem(LEGACY_USER_KEY);
  localStorage.removeItem(LEGACY_PASSWORD_KEY);
}

function normalizeCredentials(value) {
  return {
    username: String(value?.username || '').trim(),
    password: String(value?.password || '')
  };
}

/** 读取凭据，并将旧版本 localStorage 明文一次性迁移到 Android Keystore。 */
export async function loadHamQthCredentials() {
  const plugin = securePlugin();
  const legacy = normalizeCredentials({
    username: localStorage.getItem(LEGACY_USER_KEY),
    password: localStorage.getItem(LEGACY_PASSWORD_KEY)
  });

  if (plugin?.getHamQthCredentials && plugin?.setHamQthCredentials) {
    let secure = normalizeCredentials(await plugin.getHamQthCredentials());
    if (!secure.username && !secure.password && legacy.username && legacy.password) {
      await plugin.setHamQthCredentials(legacy);
      secure = legacy;
    }
    // 只有安全存储读取/迁移成功后才删除旧明文，避免升级失败造成凭据丢失。
    if (!secure.username && legacy.username) localStorage.setItem(USER_HINT_KEY, legacy.username);
    purgeLegacyCredentials();
    return secure;
  }

  // 浏览器预览没有 Android Keystore，只允许凭据在当前会话内存在。
  let session = null;
  try { session = JSON.parse(sessionStorage.getItem(WEB_CREDENTIALS_KEY) || 'null'); }
  catch (error) { /* ignore damaged preview data */ }
  if (!session && legacy.username && legacy.password) {
    session = legacy;
    sessionStorage.setItem(WEB_CREDENTIALS_KEY, JSON.stringify(legacy));
    purgeLegacyCredentials();
  }
  return normalizeCredentials(session);
}

export async function saveHamQthCredentials(username, password) {
  const credentials = normalizeCredentials({ username, password });
  const plugin = securePlugin();
  if (plugin?.setHamQthCredentials) {
    await plugin.setHamQthCredentials(credentials);
  } else if (credentials.username && credentials.password) {
    sessionStorage.setItem(WEB_CREDENTIALS_KEY, JSON.stringify(credentials));
  } else {
    sessionStorage.removeItem(WEB_CREDENTIALS_KEY);
  }
  if (credentials.username && !credentials.password) localStorage.setItem(USER_HINT_KEY, credentials.username);
  else localStorage.removeItem(USER_HINT_KEY);
  purgeLegacyCredentials();
  return credentials;
}

/** 读取并迁移旧版明文草稿。返回空字符串表示没有草稿。 */
export async function loadSecureDraft() {
  const plugin = securePlugin();
  const legacy = localStorage.getItem(LEGACY_DRAFT_KEY) || '';
  if (plugin?.getDraft && plugin?.setDraft) {
    const result = await plugin.getDraft();
    let data = String(result?.data || '');
    if (!data && legacy) {
      await plugin.setDraft({ data: legacy });
      data = legacy;
    }
    localStorage.removeItem(LEGACY_DRAFT_KEY);
    return data;
  }

  let data = sessionStorage.getItem(WEB_DRAFT_KEY) || '';
  if (!data && legacy) {
    data = legacy;
    sessionStorage.setItem(WEB_DRAFT_KEY, legacy);
    localStorage.removeItem(LEGACY_DRAFT_KEY);
  }
  return data;
}

export async function saveSecureDraft(data) {
  const serialized = String(data || '');
  const plugin = securePlugin();
  if (plugin?.setDraft) await plugin.setDraft({ data: serialized });
  else sessionStorage.setItem(WEB_DRAFT_KEY, serialized);
  localStorage.removeItem(LEGACY_DRAFT_KEY);
}

export async function clearSecureDraft() {
  const plugin = securePlugin();
  if (plugin?.clearDraft) await plugin.clearDraft();
  else sessionStorage.removeItem(WEB_DRAFT_KEY);
  localStorage.removeItem(LEGACY_DRAFT_KEY);
}
