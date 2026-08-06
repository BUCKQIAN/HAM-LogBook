/* ============================================================
   history.js - 历史记录页（history.html）逻辑
   - QSO 列表渲染（按时间倒序）
   - 搜索/筛选（呼号、日期范围、频段、模式）
   - 底部统计栏（本月、累计、各频段）
   - 点击条目跳转编辑页
   ============================================================ */

import { initDatabase, getAllQsos, getMonthlyCount, getTotalCount, getBandCounts } from './db.js';

// ========== 页面初始化 ==========

export async function initPage() {
  bindSearchEvents();

  try {
    await initDatabase();
    await loadQsoList();
    await loadStats();
  } catch (error) {
    console.error('历史页初始化失败:', error);
    window.showToast('历史: ' + (error.message || '未知错误'));
  }
}

// ========== 搜索事件 ==========

function bindSearchEvents() {
  // 搜索按钮
  const searchBtn = document.getElementById('search-btn');
  if (searchBtn) {
    searchBtn.addEventListener('click', () => loadQsoList());
  }

  document.getElementById('reset-search-btn')?.addEventListener('click', () => {
    ['search-callsign', 'search-date-from', 'search-date-to'].forEach(id => {
      const element = document.getElementById(id);
      if (element) element.value = '';
    });
    ['search-band', 'search-mode'].forEach(id => {
      const element = document.getElementById(id);
      if (element) element.value = '';
    });
    loadQsoList();
  });

  // 呼号输入框回车
  const callsignInput = document.getElementById('search-callsign');
  if (callsignInput) {
    callsignInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') loadQsoList();
    });
  }

  // 筛选条件变更自动搜索
  ['search-band', 'search-mode'].forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener('change', () => loadQsoList());
    }
  });

  // 日期变更也触发搜索
  ['search-date-from', 'search-date-to'].forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener('change', () => loadQsoList());
    }
  });
}

// ========== 构建筛选参数 ==========

function getFilters() {
  const filters = {};

  const callsign = document.getElementById('search-callsign')?.value?.trim();
  if (callsign) filters.callsign = callsign;

  const dateFrom = document.getElementById('search-date-from')?.value?.trim();
  if (dateFrom) {
    if (!isValidDisplayDate(dateFrom)) throw new Error('开始日期无效，请使用 YY/MM/DD');
    filters.dateFrom = window.displayDateToDb(dateFrom);
  }

  const dateTo = document.getElementById('search-date-to')?.value?.trim();
  if (dateTo) {
    if (!isValidDisplayDate(dateTo)) throw new Error('结束日期无效，请使用 YY/MM/DD');
    filters.dateTo = window.displayDateToDb(dateTo);
  }

  if (filters.dateFrom && filters.dateTo && filters.dateFrom > filters.dateTo) {
    throw new Error('开始日期不能晚于结束日期');
  }

  const band = document.getElementById('search-band')?.value;
  if (band) filters.band = band;

  const mode = document.getElementById('search-mode')?.value;
  if (mode) filters.mode = mode;

  return filters;
}

// ========== 加载 QSO 列表 ==========

async function loadQsoList() {
  const listContainer = document.getElementById('qso-list');
  if (!listContainer) return;

  try {
    const filters = getFilters();
    const qsos = await getAllQsos(filters);

    if (qsos.length === 0) {
      listContainer.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">📭</div>
          <div class="empty-text">暂无 QSO 记录</div>
        </div>`;
      return;
    }

    listContainer.innerHTML = qsos.map(qso => {
      const dateDisplay = window.dbDateToDisplay(qso.qso_date);
      const timeDisplay = window.dbTimeToDisplay(qso.time_on);
      const rstDisplay = [
        qso.rst_sent ? `S ${escapeHtml(qso.rst_sent)}` : '',
        qso.rst_rcvd ? `R ${escapeHtml(qso.rst_rcvd)}` : ''
      ].filter(Boolean).join(' · ') || 'RST —';
      const frequencyDisplay = qso.frequency != null && qso.frequency !== '' && Number.isFinite(Number(qso.frequency))
        ? `<span>${Number(qso.frequency).toFixed(3)} MHz</span>`
        : '';

      return `
        <div class="qso-item" data-id="${qso.id}" onclick="window.location.href='index.html?edit=${qso.id}'">
          <div class="qso-item-main">
            <div class="qso-item-callsign">${escapeHtml(qso.callsign)}</div>
            <div class="qso-item-meta">
              <span>${escapeHtml(qso.mode || '')}</span>
              <span>${escapeHtml(qso.band || '')}</span>
              ${frequencyDisplay}
              ${qso.operator_name ? `<span>👤 ${escapeHtml(qso.operator_name)}</span>` : ''}
            </div>
          </div>
          <div class="qso-item-date">${dateDisplay} ${timeDisplay}</div>
          <div class="qso-item-rst">${rstDisplay}</div>
        </div>`;
    }).join('');
  } catch (error) {
    console.error('加载 QSO 列表失败:', error);
    window.showToast('加载记录失败：' + error.message);
  }
}

// ========== 统计栏 ==========

async function loadStats() {
  try {
    const [monthlyCount, totalCount, bandCounts] = await Promise.all([
      getMonthlyCount(),
      getTotalCount(),
      getBandCounts()
    ]);

    document.getElementById('stat-monthly').textContent = monthlyCount;
    document.getElementById('stat-total').textContent = totalCount;

    const bandStatsEl = document.getElementById('stat-bands');
    if (bandStatsEl) {
      if (bandCounts.length > 0) {
        bandStatsEl.textContent = bandCounts.map(b => `${b.band}: ${b.count}`).join(' | ');
      } else {
        bandStatsEl.textContent = '暂无数据';
      }
    }
  } catch (error) {
    console.error('加载统计数据失败:', error);
  }
}

// ========== HTML 转义（防 XSS） ==========

function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function isValidDisplayDate(value) {
  const match = /^(\d{2})\/(\d{2})\/(\d{2})$/.exec(value);
  if (!match) return false;
  const year = 2000 + Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}
