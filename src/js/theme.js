/* ============================================================
   theme.js - 全局昼夜主题管理
   localStorage 使用 hamlog_ 前缀；未设置时跟随系统主题
   ============================================================ */

const THEME_KEY = 'hamlog_theme';
const systemTheme = window.matchMedia?.('(prefers-color-scheme: dark)');
let nativeThemeSync = Promise.resolve();

function preferredTheme() {
  const stored = localStorage.getItem(THEME_KEY);
  if (stored === 'day' || stored === 'night') return stored;
  return systemTheme?.matches ? 'night' : 'day';
}

function syncNativeTheme(theme) {
  const stored = localStorage.getItem(THEME_KEY);
  const preference = stored === 'day' || stored === 'night' ? stored : 'system';
  // 排队同步，快速切换主题时原生端仍以最后一次选择为准。
  nativeThemeSync = nativeThemeSync.then(async () => {
    const plugin = window.Capacitor?.Plugins?.NativeSplash;
    if (plugin?.setTheme) await plugin.setTheme({ theme, preference });
  }).catch(error => console.warn('同步原生外观失败:', error));
  return nativeThemeSync;
}

function updateThemeButtons(theme) {
  document.querySelectorAll('[data-theme-toggle]').forEach(button => {
    const nextLabel = theme === 'night' ? '切换到白昼模式' : '切换到黑夜模式';
    button.textContent = theme === 'night' ? '☀' : '☾';
    button.setAttribute('aria-label', nextLabel);
    button.setAttribute('title', nextLabel);
  });
  document.querySelectorAll('[data-theme-label]').forEach(label => {
    label.textContent = theme === 'night' ? '黑夜模式' : '白昼模式';
  });
}

function applyTheme(theme, persist = false) {
  const normalized = theme === 'night' ? 'night' : 'day';
  document.documentElement.dataset.theme = normalized;
  document.documentElement.style.colorScheme = normalized === 'night' ? 'dark' : 'light';
  if (persist) localStorage.setItem(THEME_KEY, normalized);
  updateThemeButtons(normalized);
  void syncNativeTheme(normalized);
}

window.hamlogTheme = {
  get: () => document.documentElement.dataset.theme || preferredTheme(),
  set: theme => applyTheme(theme, true),
  toggle: () => applyTheme(document.documentElement.dataset.theme === 'night' ? 'day' : 'night', true),
  syncNative: () => syncNativeTheme(window.hamlogTheme.get())
};

applyTheme(preferredTheme());

document.addEventListener('DOMContentLoaded', () => {
  updateThemeButtons(window.hamlogTheme.get());
  document.querySelectorAll('[data-theme-toggle]').forEach(button => {
    button.addEventListener('click', window.hamlogTheme.toggle);
  });
});

systemTheme?.addEventListener?.('change', () => {
  if (!['day', 'night'].includes(localStorage.getItem(THEME_KEY))) applyTheme(preferredTheme());
});
window.addEventListener('pageshow', () => applyTheme(preferredTheme()));
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') applyTheme(preferredTheme());
});
