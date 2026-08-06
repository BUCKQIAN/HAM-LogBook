/* ============================================================
   nav.js - 底部导航栏动态渲染 + 全局 Toast
   每个 HTML 页面底部放 <div id="nav-container"></div>
   并用 <script type="module" src="js/nav.js"></script> 引入
   ============================================================ */

// 导航页面定义
const pages = [
  { id: 'record',   icon: '＋', label: '记录', href: 'index.html' },
  { id: 'history',  icon: '≡', label: '历史', href: 'history.html' },
  { id: 'repeater', icon: '⌁', label: '中继', href: 'repeater.html' },
  { id: 'settings', icon: '○', label: '设置', href: 'settings.html' }
];

// 获取当前页面文件名
const currentPath = window.location.pathname.split('/').pop() || 'index.html';

// 渲染导航栏
const navContainer = document.getElementById('nav-container');
if (navContainer) {
  navContainer.innerHTML = '<nav class="bottom-nav">' + pages.map(p => {
    const isActive = currentPath === p.href;
    return `<a href="${p.href}" class="nav-item ${isActive ? 'nav-active' : ''}">
      <span class="nav-icon">${p.icon}</span>
      <span>${p.label}</span>
    </a>`;
  }).join('') + '</nav>';
}

// ========== 全局 Toast 函数 ==========
window.showToast = function (message, duration = 2500) {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.textContent = message;
  toast.classList.remove('hidden');
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => toast.classList.add('hidden'), duration);
};

// ========== 日期/时间格式转换工具（挂 window 供全局使用）==========

/**
 * 数据库日期格式 → 显示格式: YYYYMMDD → YY/MM/DD
 */
window.dbDateToDisplay = function (dbDate) {
  if (!dbDate || dbDate.length !== 8) return dbDate || '';
  return dbDate.substring(2, 4) + '/' + dbDate.substring(4, 6) + '/' + dbDate.substring(6, 8);
};

/**
 * 显示日期格式 → 数据库格式: YY/MM/DD → YYYYMMDD
 */
window.displayDateToDb = function (displayDate) {
  if (!displayDate || displayDate.length !== 8) return displayDate || '';
  const parts = displayDate.split('/');
  if (parts.length !== 3) return displayDate;
  return '20' + parts[0] + parts[1] + parts[2];
};

/**
 * 数据库时间格式 → 显示格式: HHMMSS → HH:MM:SS
 */
window.dbTimeToDisplay = function (dbTime) {
  if (!dbTime || dbTime.length !== 6) return dbTime || '';
  return dbTime.substring(0, 2) + ':' + dbTime.substring(2, 4) + ':' + dbTime.substring(4, 6);
};

/**
 * 显示时间格式 → 数据库格式: HH:MM:SS → HHMMSS
 */
window.displayTimeToDb = function (displayTime) {
  if (!displayTime || displayTime.length !== 8) return displayTime || '';
  return displayTime.replace(/:/g, '');
};

/**
 * 获取当前日期的 YY/MM/DD 格式字符串（本地时区）
 */
window.getTodayDisplay = function () {
  const now = new Date();
  const yy = String(now.getFullYear()).slice(-2);
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  return `${yy}/${mm}/${dd}`;
};

/**
 * 获取当前时间的 HH:MM:SS 格式字符串（本地时区）
 */
window.getNowDisplay = function () {
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
};

/**
 * 获取当前 UTC 日期的 YY/MM/DD 格式字符串
 * 通联日志应使用 UTC 标准时（北京时间 -8 小时）
 */
window.getTodayUTC = function () {
  const now = new Date();
  const yy = String(now.getUTCFullYear()).slice(-2);
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(now.getUTCDate()).padStart(2, '0');
  return `${yy}/${mm}/${dd}`;
};

/**
 * 获取当前 UTC 时间的 HH:MM:SS 格式字符串
 * 通联日志应使用 UTC 标准时（北京时间 -8 小时）
 */
window.getNowUTC = function () {
  const now = new Date();
  const hh = String(now.getUTCHours()).padStart(2, '0');
  const mm = String(now.getUTCMinutes()).padStart(2, '0');
  const ss = String(now.getUTCSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
};

/**
 * 获取 ADIF 导出用的日期字符串 YYYYMMDD
 */
window.getExportDateString = function () {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}${m}${d}`;
};

// ========== 全局错误处理 ==========
// 确保 showToast 在最坏情况下也能工作
if (typeof window.showToast !== 'function') {
  window.showToast = function (message, duration) {
    // 最后的保底：用 alert 显示错误
    try {
      const t = document.getElementById('toast');
      if (t) { t.textContent = message; t.classList.remove('hidden'); setTimeout(function() { t.classList.add('hidden'); }, duration || 2500); }
    } catch(e) {
      alert(message);
    }
  };
}
