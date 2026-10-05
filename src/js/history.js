/* ============================================================
   history.js - 历史记录页（history.html）逻辑
   - QSO 列表渲染（按时间倒序）
   - 搜索/筛选（呼号、日期范围、频段、模式）
   - 底部统计栏（本月、累计、各频段）
   - 点击条目跳转编辑页
   ============================================================ */

import { initDatabase, getQsoPage, getMonthlyCount, getTotalCount, getBandCounts } from './db.js';
import { BAND_CATALOG } from './radio.js';
import { refreshFieldPickers } from './field-picker.js';

const HISTORY_PAGE_SIZE = 100;
const MAX_RENDERED_QSO_ITEMS = 1000;
let loadedCount = 0;
let activeFiltersKey = '';
let hasMoreRows = false;
let isLoadingRows = false;
let nextPageCursor = null;
let latestListRequest = 0;

// ========== 页面初始化 ==========

export async function initPage() {
  renderBandFilterOptions();
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

function renderBandFilterOptions() {
  const select = document.getElementById('search-band');
  if (!select) return;
  select.replaceChildren();
  const all = document.createElement('option');
  all.value = '';
  all.textContent = '全部';
  select.appendChild(all);
  for (const band of BAND_CATALOG) {
    const option = document.createElement('option');
    option.value = band.id;
    option.textContent = band.label;
    select.appendChild(option);
  }
}

// ========== 搜索事件 ==========

function bindSearchEvents() {
  document.getElementById('qso-list')?.addEventListener('click', event => {
    const item = event.target.closest('.qso-item');
    if (!item) return;
    const id = Number(item.dataset.id);
    if (Number.isInteger(id) && id > 0) window.location.href = `index.html?edit=${id}`;
  });
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
    refreshFieldPickers();
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

  document.getElementById('load-more-btn')?.addEventListener('click', () => {
    if (!isLoadingRows && hasMoreRows) void loadQsoList({ append: true });
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

async function loadQsoList({ append = false } = {}) {
  const listContainer = document.getElementById('qso-list');
  if (!listContainer || (append && isLoadingRows)) return;

  const requestId = ++latestListRequest;

  try {
    const filters = getFilters();
    const filtersKey = JSON.stringify(filters);
    if (!append || filtersKey !== activeFiltersKey) {
      append = false;
      activeFiltersKey = filtersKey;
      loadedCount = 0;
      hasMoreRows = false;
      nextPageCursor = null;
      listContainer.replaceChildren();
    }
    isLoadingRows = true;
    updateLoadMoreButton();
    const page = await getQsoPage(
      filters,
      HISTORY_PAGE_SIZE,
      append ? nextPageCursor : null,
      append ? loadedCount : 0
    );
    if (requestId !== latestListRequest) return;
    const qsos = page.qsos;

    if (qsos.length === 0 && loadedCount === 0) {
      listContainer.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">📭</div>
          <div class="empty-text">暂无 QSO 记录</div>
        </div>`;
      hasMoreRows = false;
      updateLoadMoreButton();
      return;
    }

    listContainer.insertAdjacentHTML('beforeend', qsos.map(renderQsoItem).join(''));
    trimRenderedHistory(listContainer);
    loadedCount += qsos.length;
    hasMoreRows = page.hasMore;
    nextPageCursor = page.nextCursor;
  } catch (error) {
    if (requestId !== latestListRequest) return;
    console.error('加载 QSO 列表失败:', error);
    window.showToast('加载记录失败：' + error.message);
  } finally {
    if (requestId === latestListRequest) {
      isLoadingRows = false;
      updateLoadMoreButton();
    }
  }
}

function trimRenderedHistory(listContainer) {
  const items = listContainer.querySelectorAll('.qso-item');
  const excess = items.length - MAX_RENDERED_QSO_ITEMS;
  if (excess <= 0) return;
  for (let index = 0; index < excess; index++) items[index].remove();

  let notice = listContainer.querySelector('.history-window-notice');
  if (!notice) {
    notice = document.createElement('div');
    notice.className = 'history-window-notice helper-text';
    notice.textContent = '为控制长期日志的内存占用，较早加载的页面已从画面移除；点击重置可返回最新记录。';
    listContainer.prepend(notice);
  }
}

function renderQsoItem(qso) {
  const dateDisplay = window.dbDateToDisplay(qso.qso_date);
  const timeDisplay = window.dbTimeToDisplay(qso.time_on);
  const rstDisplay = [
    qso.rst_sent ? `S ${escapeHtml(qso.rst_sent)}` : '',
    qso.rst_rcvd ? `R ${escapeHtml(qso.rst_rcvd)}` : ''
  ].filter(Boolean).join(' · ') || 'RST —';
  const qslDisplay = Number(qso.qsl_considered) === 1 ? 'PSE QSL' : 'NO QSL';
  const frequencyDisplay = qso.frequency != null && qso.frequency !== '' && Number.isFinite(Number(qso.frequency))
    ? `<span>${Number(qso.frequency).toFixed(3)} MHz</span>`
    : '';

  return `
    <div class="qso-item" data-id="${qso.id}">
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
      <div class="qso-item-rst">${rstDisplay} · ${qslDisplay}</div>
    </div>`;
}

function updateLoadMoreButton() {
  const button = document.getElementById('load-more-btn');
  if (!button) return;
  button.hidden = !hasMoreRows;
  // 某些 WebView 的作者样式会覆盖 hidden 的默认 display；内联状态作为兼容兜底。
  button.style.display = hasMoreRows ? '' : 'none';
  button.disabled = isLoadingRows;
  button.textContent = isLoadingRows ? '正在加载…' : `加载更多（已读取 ${loadedCount} 条）`;
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
