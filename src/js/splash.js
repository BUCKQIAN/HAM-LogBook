/* ============================================================
   splash.js - Android 原生启动页设置桥接
   设置页保留五种预览；系统启动窗口之后由 NativeSplashView 保证显示用户所选方案。
   ============================================================ */

export const SPLASH_STYLE_KEY = 'hamlog_splash_style';

export const SPLASH_STYLES = Object.freeze([
  { id: 'A', title: '纸张与墨色', subtitle: '离线通联日志' },
  { id: 'B', title: '台站日志卡片', subtitle: 'OFFLINE FIRST' },
  { id: 'C', title: '极简无线电波', subtitle: '每一次通联，清晰记录' },
  { id: 'D', title: '深色夜间电台', subtitle: '夜间通联记录' },
  { id: 'E', title: '日志本翻页', subtitle: '记录每一次通联' }
]);

function normalizeStyle(style) {
  const value = String(style || '').toUpperCase();
  return SPLASH_STYLES.some(item => item.id === value) ? value : 'A';
}

export function getSplashStyle() {
  return normalizeStyle(localStorage.getItem(SPLASH_STYLE_KEY));
}

function getNativeSplashPlugin() {
  return window.Capacitor?.Plugins?.NativeSplash || null;
}

/** 将网页设置同步到 Android SharedPreferences，供下次进程启动前读取。 */
export async function syncNativeSplashStyle(style = getSplashStyle()) {
  const normalized = normalizeStyle(style);
  const plugin = getNativeSplashPlugin();
  if (!plugin?.setStyle) {
    return { style: normalized, nativeAvailable: false, systemThemeApplied: false };
  }
  try {
    const result = await plugin.setStyle({ style: normalized });
    return {
      style: normalized,
      nativeAvailable: true,
      systemThemeApplied: result?.systemThemeApplied === true,
      takesEffectNextColdStart: result?.takesEffectNextColdStart === true
    };
  } catch (error) {
    console.warn('同步原生启动页设置失败:', error);
    return { style: normalized, nativeAvailable: true, systemThemeApplied: false, error };
  }
}

export async function setSplashStyle(style) {
  const normalized = normalizeStyle(style);
  localStorage.setItem(SPLASH_STYLE_KEY, normalized);
  return syncNativeSplashStyle(normalized);
}

/** 首页首帧就绪后关闭用户所选的 Android 原生覆盖层；浏览器预览时自动跳过。 */
export async function hideNativeSplash() {
  const plugin = getNativeSplashPlugin();
  if (!plugin?.hide) return;
  try {
    await plugin.hide();
  } catch (error) {
    console.warn('关闭原生启动页失败:', error);
  }
}

export function renderSplashStyleOptions(container, selectedStyle, onSelect) {
  if (!container) return;
  const selected = normalizeStyle(selectedStyle);
  let latestSelectionRequest = 0;
  container.innerHTML = SPLASH_STYLES.map(item => `
    <label class="splash-style-option ${item.id === selected ? 'is-selected' : ''}">
      <input type="radio" name="splash-style" value="${item.id}" ${item.id === selected ? 'checked' : ''}>
      <span class="splash-style-option__preview splash-style-option__preview--${item.id.toLowerCase()}">
        <span class="splash-style-option__mark">${item.id === 'C' ? '' : item.id === 'E' ? 'QSO' : 'HAM'}</span>
        <span class="splash-style-option__wordmark">HAM LOGBOOK</span>
        <span class="splash-style-option__subtitle">${item.subtitle}</span>
      </span>
      <span class="splash-style-option__copy"><strong>方案 ${item.id}</strong><small>${item.title}</small></span>
    </label>`).join('');

  container.querySelectorAll('input[name="splash-style"]').forEach(input => {
    input.addEventListener('change', async event => {
      const requestId = ++latestSelectionRequest;
      const result = await setSplashStyle(event.target.value);
      if (requestId !== latestSelectionRequest) return;
      const next = result.style;
      container.querySelectorAll('.splash-style-option').forEach(option => {
        option.classList.toggle('is-selected', option.querySelector('input')?.value === next);
      });
      if (typeof onSelect === 'function') onSelect(next, result);
    });
  });
}
