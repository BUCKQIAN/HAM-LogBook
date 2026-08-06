/* ============================================================
   theme.js - 全局昼夜主题管理
   localStorage 使用 hamlog_ 前缀；未设置时跟随系统主题
   ============================================================ */

const THEME_KEY = 'hamlog_theme';

function preferredTheme() {
  const stored = localStorage.getItem(THEME_KEY);
  if (stored === 'day' || stored === 'night') return stored;
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'night' : 'day';
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
}

window.hamlogTheme = {
  get: () => document.documentElement.dataset.theme || preferredTheme(),
  set: theme => applyTheme(theme, true),
  toggle: () => applyTheme(document.documentElement.dataset.theme === 'night' ? 'day' : 'night', true)
};

applyTheme(preferredTheme());

document.addEventListener('DOMContentLoaded', () => {
  updateThemeButtons(window.hamlogTheme.get());
  document.querySelectorAll('[data-theme-toggle]').forEach(button => {
    button.addEventListener('click', window.hamlogTheme.toggle);
  });
});

