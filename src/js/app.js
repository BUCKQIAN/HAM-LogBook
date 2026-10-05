/* ============================================================
   app.js - 新建/编辑 QSO 页（index.html）逻辑
   - 表单填充、验证、保存/更新/删除
   - GPS 定位、呼号查询、默认位置
   - 中继台预设频率读取
   ============================================================ */

import {
  initDatabase,
  saveQso,
  updateQso,
  getQsoById,
  deleteQso,
  checkDuplicate,
  getCounterpartHistory,
  getAllRepeaters
} from './db.js';
import { getCurrentPosition } from './gps.js';
import { latLngToLocator, isValidLocator, normalizeLocator } from './locator.js';
import { queryCallsign, getCallbookLabel } from './callbook.js';
import { BAND_CATALOG, detectBandFromFrequency } from './radio.js';
import {
  getAllowedBandIds,
  getStoredCnOperatorClass,
  isBandAllowedForNewQso
} from './operator-license.js';
import { buildCounterpartProfiles, getCounterpartProfileValues } from './counterpart-profiles.js';
import { getSplashStyle, hideNativeSplash, syncNativeSplashStyle } from './splash.js';
import { hasMeaningfulDraftChanges, hasMeaningfulLegacyDraft } from './qso-draft.js';
import { clearSecureDraft, loadSecureDraft, saveSecureDraft } from './secure-data.js';
import { maybeCreateAutomaticBackup } from './automatic-backup.js';
import { openChoiceDialog, refreshFieldPickers, focusFieldPicker } from './field-picker.js';
import { readQsoDefaults, repeaterFrequencyOptions } from './station-presets.js';

// ========== 页面状态 ==========
let isEditMode = false;
let editQsoId = null;
const QSO_DRAFT_VERSION = 2;
const QSO_DRAFT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const QSO_DRAFT_FIELDS = [
  // 日期和时间始终在进入记录页时取当前 UTC，不写入、恢复或触发草稿。
  'callsign', 'mode', 'band', 'frequency',
  'rst-sent', 'rst-rcvd', 'their-rig', 'their-antenna', 'their-power',
  'op-qth', 'op-name', 'op-locator', 'my-rig', 'my-power', 'qsl-considered',
  'my-lat', 'my-lon', 'my-alt', 'my-locator', 'notes'
];
let draftIsDirty = false;
let editIsDirty = false;
let draftSaveTimer = null;
let draftWritePromise = Promise.resolve();
let draftBaselineFields = {};
let currentOperatorClass = 'A';
let counterpartProfiles = [];
let counterpartRequestId = 0;
let lastRestrictedBandWarning = '';
let pendingDraftNavigationHref = '';
let draftDialogLastFocusedElement = null;

// ========== 页面初始化 ==========

/**
 * 初始化页面（DOMContentLoaded 时调用）
 */
export async function initPage() {
  const requestedEditId = new URLSearchParams(window.location.search).get('edit');

  // 先绑定所有事件（不依赖数据库，确保始终可用）
  bindEvents();
  setupLocatorAutoCalc();
  updateLookupButtonState();
  window.addEventListener('online', updateLookupButtonState);
  window.addEventListener('offline', updateLookupButtonState);

  // 必须在恢复草稿或旧记录前生成选项，避免 select 因找不到值而清空频段。
  renderAllowedBandOptions();

  // 设置默认日期时间（纯 JS，不依赖数据库）
  setDefaultDateTime();
  resetQsoDraftBaseline();

  // 加载设备预设列表（从 localStorage）
  loadRigPresets();
  window.addEventListener('pageshow', event => {
    if (!event.persisted) return;
    loadRigPresets();
    const band = document.getElementById('band').value;
    renderAllowedBandOptions();
    ensureStoredBandOption(band, '原填值');
    document.getElementById('band').value = band;
    checkRepeaterPreset();
    refreshFieldPickers();
    updateLookupButtonState();
  });

  // 新建记录在意外切页、进入后台或重启后都可恢复；编辑既有 QSO 时不使用草稿。
  if (!requestedEditId) await restoreQsoDraft();

  // 从中继页主动选择的预设应覆盖旧草稿中的频率。
  checkRepeaterPreset();

  // 先同步旧版网页设置；原生收到就绪通知后确认 WebView 绘制状态，再退出启动页。
  await Promise.all([syncNativeSplashStyle(getSplashStyle()), window.hamlogTheme?.syncNative?.()]);
  void hideNativeSplash();

  // 尝试初始化数据库（失败不阻断其他功能）
  try {
    await initDatabase();
    // 以下依赖数据库的操作
    if (requestedEditId) {
      try {
        await loadQsoForEdit(parseInt(requestedEditId, 10));
      } catch (error) {
        window.showToast('加载编辑记录: ' + (error.message || '失败'));
      }
    }
  } catch (error) {
    console.error('数据库初始化失败:', error);
    window.showToast('数据库: ' + (error.message || '未知错误'));
  }
}

// ========== 默认日期时间 ==========

function setDefaultDateTime() {
  const dateInput = document.getElementById('qso-date');
  const timeOnInput = document.getElementById('time-on');
  const timeOffInput = document.getElementById('time-off');

  // 通联日志使用 UTC 标准时（北京时间 -8 小时）
  // 优先使用 nav.js 的全局函数，不可用时使用内置后备
  const getDate = (typeof window.getTodayUTC === 'function') ? window.getTodayUTC : getUTCDateFallback;
  const getTime = (typeof window.getNowUTC === 'function') ? window.getNowUTC : getUTCTimeFallback;

  if (dateInput && !dateInput.value) {
    dateInput.value = getDate();
  }
  if (timeOnInput && !timeOnInput.value) {
    timeOnInput.value = getTime();
  }
  if (timeOffInput && !timeOffInput.value) {
    timeOffInput.value = getTime();
  }
}

// 内置 UTC 日期后备（防止 nav.js 脚本加载失败）
function getUTCDateFallback() {
  const now = new Date();
  const yy = String(now.getUTCFullYear()).slice(-2);
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(now.getUTCDate()).padStart(2, '0');
  return `${yy}/${mm}/${dd}`;
}

function getUTCTimeFallback() {
  const now = new Date();
  const hh = String(now.getUTCHours()).padStart(2, '0');
  const mm = String(now.getUTCMinutes()).padStart(2, '0');
  const ss = String(now.getUTCSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

// ========== 设备预设 ==========

function loadRigPresets() {
  const datalist = document.getElementById('my-rigs-list');
  datalist?.replaceChildren();
  try {
    const rigsStr = localStorage.getItem('hamlog_my_rigs');
    if (!rigsStr) return;
    const rigs = JSON.parse(rigsStr);
    if (!Array.isArray(rigs) || rigs.length === 0) return;
    if (datalist) {
      datalist.replaceChildren();
      rigs.forEach(rig => {
        const option = document.createElement('option');
        option.value = String(rig);
        datalist.appendChild(option);
      });
    }
  } catch (e) { /* ignore */ }
}

function handleDefaultFrequency() {
  const defaults = readQsoDefaults();
  if (defaults.frequency === null) {
    window.showToast('请先在设置 → 台站资料与预设中保存默认频率');
    return;
  }
  document.getElementById('frequency').value = defaults.frequency;
  applyDetectedBand();
  markQsoDraftDirty();
  window.showToast('已填入默认频率');
}

function handleDefaultEquipment() {
  const defaults = readQsoDefaults();
  if (!defaults.rig && defaults.power === null) {
    window.showToast('请先在设置 → 台站资料与预设中保存默认设备和功率');
    return;
  }
  if (defaults.rig) document.getElementById('my-rig').value = defaults.rig;
  if (defaults.power !== null) document.getElementById('my-power').value = String(defaults.power);
  markQsoDraftDirty();
  window.showToast('已填入默认设备和功率');
}

function handleExcellentSignal() {
  document.getElementById('rst-sent').value = '59';
  document.getElementById('rst-rcvd').value = '59';
  markQsoDraftDirty();
  window.showToast('我方发送和接收信号已填入 59');
}

async function handleChooseRepeater() {
  const button = document.getElementById('choose-repeater-btn');
  if (button.disabled) return;
  button.disabled = true;
  try {
    await initDatabase();
    const repeaters = await getAllRepeaters();
    openChoiceDialog({
      title: '选择中继台频率',
      options: repeaterFrequencyOptions(repeaters),
      emptyMessage: '暂无中继台，请先在中继页面添加',
      onSelect: frequency => {
        document.getElementById('frequency').value = frequency;
        applyDetectedBand();
        markQsoDraftDirty();
        window.showToast('已填入中继台频率');
      }
    });
  } catch (error) {
    window.showToast('读取中继台失败：' + (error.message || '未知错误'));
  } finally { button.disabled = false; }
}

// ========== 操作证类别与频段选项 ==========

function renderAllowedBandOptions() {
  currentOperatorClass = getStoredCnOperatorClass();
  const bandSelect = document.getElementById('band');
  if (!bandSelect) return;

  const allowed = new Set(getAllowedBandIds(currentOperatorClass));
  bandSelect.replaceChildren();
  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = '选择频段';
  bandSelect.appendChild(placeholder);

  for (const band of BAND_CATALOG) {
    if (!allowed.has(band.id)) continue;
    const option = document.createElement('option');
    option.value = band.id;
    option.textContent = band.label;
    bandSelect.appendChild(option);
  }
}

/** 保留旧记录/旧草稿中的频段，但不把它加入当前类别的新建可选目录。 */
function ensureStoredBandOption(value, sourceLabel) {
  const band = String(value || '').trim().toLowerCase();
  const bandSelect = document.getElementById('band');
  if (!band || !bandSelect || Array.from(bandSelect.options).some(option => option.value === band)) return;
  const option = document.createElement('option');
  option.value = band;
  option.textContent = `${band}（${sourceLabel}）`;
  option.dataset.storedBand = 'true';
  bandSelect.appendChild(option);
}

// ========== 手动获取 UTC 时间 ==========

function handleRefreshUTCTime() {
  const dateInput = document.getElementById('qso-date');
  const timeOnInput = document.getElementById('time-on');
  const timeOffInput = document.getElementById('time-off');

  const getDate = (typeof window.getTodayUTC === 'function') ? window.getTodayUTC : getUTCDateFallback;
  const getTime = (typeof window.getNowUTC === 'function') ? window.getNowUTC : getUTCTimeFallback;

  dateInput.value = getDate();
  timeOnInput.value = getTime();
  timeOffInput.value = getTime();
  window.showToast('已更新为当前 UTC 时间');
}

// ========== 中继台预设 ==========

function checkRepeaterPreset() {
  const presetStr = localStorage.getItem('hamlog_repeater_preset');
  if (!presetStr) return;

  try {
    const preset = JSON.parse(presetStr);
    if (preset.frequency != null) {
      document.getElementById('frequency').value = preset.frequency;
      applyDetectedBand();
      markQsoDraftDirty();
    }
  } catch (e) {
    // ignore
  }
  localStorage.removeItem('hamlog_repeater_preset');
}

// ========== 编辑模式 ==========

async function loadQsoForEdit(id) {
  try {
    const qso = await getQsoById(id);
    if (!qso) {
      window.showToast('未找到该 QSO 记录');
      return;
    }

    populateForm(qso);
    setEditMode(true, id);
  } catch (error) {
    window.showToast('加载 QSO 失败：' + error.message);
  }
}

function populateForm(qso) {
  document.getElementById('qso-date').value = window.dbDateToDisplay(qso.qso_date);
  document.getElementById('time-on').value = window.dbTimeToDisplay(qso.time_on);
  document.getElementById('time-off').value = window.dbTimeToDisplay(qso.time_off);
  document.getElementById('callsign').value = qso.callsign || '';
  const modeSelect = document.getElementById('mode');
  const mode = qso.mode || 'FM';
  if (mode && !Array.from(modeSelect.options).some(option => option.value === mode)) {
    const option = document.createElement('option');
    option.value = mode;
    option.textContent = mode;
    modeSelect.appendChild(option);
  }
  modeSelect.value = mode;
  updateRSTPlaceholders();
  ensureStoredBandOption(qso.band, '历史记录值');
  document.getElementById('band').value = String(qso.band || '').toLowerCase();
  document.getElementById('frequency').value = qso.frequency ?? '';
  document.getElementById('rst-sent').value = qso.rst_sent || '';
  document.getElementById('rst-rcvd').value = qso.rst_rcvd || '';
  document.getElementById('op-name').value = qso.operator_name || '';
  document.getElementById('op-qth').value = qso.qth || '';
  document.getElementById('op-locator').value = normalizeLocator(qso.locator || '');
  document.getElementById('my-lat').value = qso.my_lat ?? '';
  document.getElementById('my-lon').value = qso.my_lon ?? '';
  document.getElementById('my-alt').value = qso.my_alt ?? '';
  document.getElementById('my-locator').value = normalizeLocator(qso.my_locator || ''); // 旧记录无此字段时从经纬度补算
  document.getElementById('their-power').value = qso.their_power ?? '';
  document.getElementById('their-rig').value = qso.their_rig || '';
  document.getElementById('their-antenna').value = qso.their_antenna || '';
  document.getElementById('my-power').value = qso.my_power ?? '';
  document.getElementById('my-rig').value = qso.my_rig || '';
  document.getElementById('qsl-considered').value = Number(qso.qsl_considered) === 1 ? '1' : '0';
  document.getElementById('notes').value = qso.notes || '';

  // 旧记录没有保存网格时，根据经纬度补算。
  if (!qso.my_locator) autoCalcMyLocator();
  refreshFieldPickers();
}

function setEditMode(enabled, qsoId = null) {
  isEditMode = enabled;
  editQsoId = qsoId;
  editIsDirty = false;

  const saveBtn = document.getElementById('save-btn');
  const deleteBtn = document.getElementById('delete-btn');
  const clearBtn = document.getElementById('clear-btn');
  deleteBtn.hidden = !enabled;

  if (enabled) {
    saveBtn.innerHTML = '💾 更新 QSO';
    deleteBtn.style.display = 'flex';
    clearBtn.textContent = '取消编辑';
    document.documentElement.dataset.editId = qsoId;
    hideCounterpartProfiles();
  } else {
    saveBtn.innerHTML = '💾 保存 QSO';
    deleteBtn.style.display = 'none';
    clearBtn.textContent = '清除表单';
    delete document.documentElement.dataset.editId;
    window.history.replaceState({}, '', window.location.pathname);
  }
  updateCounterpartHistoryButtonState();
}

// ========== 事件绑定 ==========

function bindEvents() {
  document.getElementById('save-btn').addEventListener('click', handleSave);
  document.getElementById('delete-btn').addEventListener('click', handleDelete);
  document.getElementById('clear-btn').addEventListener('click', handleClear);
  document.getElementById('gps-btn').addEventListener('click', handleGetLocation);
  document.getElementById('default-loc-btn').addEventListener('click', handleUseDefaultLocation);
  document.getElementById('lookup-btn').addEventListener('click', handleCallsignLookup);
  document.getElementById('counterpart-history-btn')?.addEventListener('click', handleCounterpartHistoryLookup);
  document.getElementById('counterpart-profile-close')?.addEventListener('click', hideCounterpartProfiles);
  document.getElementById('callsign')?.addEventListener('input', () => {
    counterpartRequestId++;
    hideCounterpartProfiles();
  });
  document.getElementById('utc-time-btn').addEventListener('click', handleRefreshUTCTime);
  document.getElementById('default-frequency-btn')?.addEventListener('click', handleDefaultFrequency);
  document.getElementById('choose-repeater-btn')?.addEventListener('click', handleChooseRepeater);
  document.getElementById('default-equipment-btn')?.addEventListener('click', handleDefaultEquipment);
  document.getElementById('excellent-signal-btn')?.addEventListener('click', handleExcellentSignal);

  // 输入时即时识别频段；中间输入值不弹类别提示，完成录入后再提示。
  const frequencyInput = document.getElementById('frequency');
  frequencyInput.addEventListener('input', () => applyDetectedBand({ warnOnRestricted: false }));
  frequencyInput.addEventListener('change', applyDetectedBand);
  frequencyInput.addEventListener('blur', applyDetectedBand);

  document.getElementById('mode').addEventListener('change', updateRSTPlaceholders);
  bindQsoDraftProtection();
  updateRSTPlaceholders();
  updateCounterpartHistoryButtonState();
}

// ========== 新建 QSO 草稿保护 ==========

function bindQsoDraftProtection() {
  QSO_DRAFT_FIELDS.forEach(id => {
    const input = document.getElementById(id);
    input?.addEventListener('input', markQsoDraftDirty);
    input?.addEventListener('change', markQsoDraftDirty);
  });

  // 移动端的 beforeunload 不可靠，因此以可恢复草稿为主，并在主动导航前再次落盘。
  document.querySelectorAll('.bottom-nav a').forEach(link => {
    link.addEventListener('click', event => {
      if (link.pathname === window.location.pathname) {
        event.preventDefault();
        return;
      }
      if (isEditMode) {
        if (editIsDirty && !confirm('当前编辑尚未保存，确定离开此页面吗？')) event.preventDefault();
        return;
      }
      if (!draftIsDirty || !hasMeaningfulCurrentDraft()) {
        if (draftIsDirty) void clearQsoDraft();
        return;
      }
      event.preventDefault();
      showDraftLeaveDialog(link.href);
    });
  });
  bindDraftLeaveDialog();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void persistQsoDraft();
  });
  window.addEventListener('pagehide', () => void persistQsoDraft());
}

function bindDraftLeaveDialog() {
  const dialog = document.getElementById('draft-leave-dialog');
  if (!dialog) return;
  document.getElementById('draft-leave-delete')?.addEventListener('click', async () => {
    const href = pendingDraftNavigationHref;
    await clearQsoDraft();
    closeDraftLeaveDialog(false);
    if (href) window.location.href = href;
  });
  document.getElementById('draft-leave-temporary')?.addEventListener('click', async () => {
    if (!await persistQsoDraft()) {
      window.showToast('草稿保存失败，无法暂时离开；请先保存 QSO', 4000);
      return;
    }
    const href = pendingDraftNavigationHref;
    closeDraftLeaveDialog(false);
    if (href) window.location.href = href;
  });
  document.getElementById('draft-leave-continue')?.addEventListener('click', () => {
    closeDraftLeaveDialog();
  });
  dialog.addEventListener('click', event => {
    if (event.target === dialog) closeDraftLeaveDialog();
  });
  dialog.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeDraftLeaveDialog();
    }
  });
}

function showDraftLeaveDialog(href) {
  const dialog = document.getElementById('draft-leave-dialog');
  if (!dialog) return;
  pendingDraftNavigationHref = href;
  draftDialogLastFocusedElement = document.activeElement;
  dialog.hidden = false;
  document.body.classList.add('modal-open');
  window.requestAnimationFrame(() => document.getElementById('draft-leave-continue')?.focus());
}

function closeDraftLeaveDialog(restoreFocus = true) {
  const dialog = document.getElementById('draft-leave-dialog');
  if (dialog) dialog.hidden = true;
  document.body.classList.remove('modal-open');
  pendingDraftNavigationHref = '';
  if (restoreFocus && draftDialogLastFocusedElement?.focus) draftDialogLastFocusedElement.focus();
  draftDialogLastFocusedElement = null;
}

function markQsoDraftDirty() {
  if (isEditMode) {
    editIsDirty = true;
    return;
  }
  draftIsDirty = true;
  clearTimeout(draftSaveTimer);
  draftSaveTimer = setTimeout(() => void persistQsoDraft(), 150);
}

function captureQsoDraftFields() {
  const fields = {};
  QSO_DRAFT_FIELDS.forEach(id => {
    const input = document.getElementById(id);
    if (input) fields[id] = input.value;
  });
  return fields;
}

function resetQsoDraftBaseline() {
  draftBaselineFields = captureQsoDraftFields();
}

function hasMeaningfulCurrentDraft() {
  return hasMeaningfulDraftChanges(captureQsoDraftFields(), draftBaselineFields);
}

function queueDraftWrite(operation) {
  draftWritePromise = draftWritePromise.catch(() => undefined).then(operation);
  return draftWritePromise;
}

async function persistQsoDraft() {
  if (isEditMode || !draftIsDirty) return true;
  const fields = captureQsoDraftFields();
  if (!hasMeaningfulDraftChanges(fields, draftBaselineFields)) {
    await clearQsoDraft();
    return true;
  }
  try {
    const data = JSON.stringify({
      version: QSO_DRAFT_VERSION,
      saved_at: Date.now(),
      baseline: draftBaselineFields,
      fields
    });
    await queueDraftWrite(() => saveSecureDraft(data));
    return true;
  } catch (error) {
    console.warn('保存 QSO 草稿失败:', error);
    return false;
  }
}

async function restoreQsoDraft() {
  try {
    const raw = await loadSecureDraft();
    if (!raw) return;
    const draft = JSON.parse(raw);
    if (![1, QSO_DRAFT_VERSION].includes(draft?.version) || !draft.fields || typeof draft.fields !== 'object') {
      throw new Error('invalid draft');
    }
    if (!Number.isFinite(Number(draft.saved_at)) || Date.now() - Number(draft.saved_at) > QSO_DRAFT_MAX_AGE_MS) {
      await clearQsoDraft();
      return;
    }
    const meaningful = hasMeaningfulLegacyDraft(draft.fields);
    if (!meaningful) {
      await clearQsoDraft();
      return;
    }
    QSO_DRAFT_FIELDS.forEach(id => {
      const input = document.getElementById(id);
      if (input && typeof draft.fields[id] === 'string') {
        if (id === 'band') {
          const draftBand = draft.fields[id].trim().toLowerCase();
          ensureStoredBandOption(draftBand, '草稿原值');
          input.value = draftBand;
        } else {
          input.value = draft.fields[id];
        }
      }
    });
    updateRSTPlaceholders();
    draftIsDirty = true;
    refreshFieldPickers();
    window.showToast('已恢复未保存的 QSO 草稿');
  } catch (error) {
    console.warn('读取加密 QSO 草稿失败:', error);
    try { await clearQsoDraft(); }
    catch (storageError) { /* ignore */ }
  }
}

async function clearQsoDraft() {
  clearTimeout(draftSaveTimer);
  draftSaveTimer = null;
  draftIsDirty = false;
  try { await queueDraftWrite(clearSecureDraft); }
  catch (error) { console.warn('清除 QSO 草稿失败:', error); }
}

function queueAutomaticBackup() {
  void maybeCreateAutomaticBackup().catch(error => {
    window.showToast('QSO 已保存，但自动备份失败：' + (error.message || String(error)), 5000);
  });
}

// ========== 保存 QSO ==========

async function handleSave() {
  // 防止重复点击
  const saveBtn = document.getElementById('save-btn');
  if (saveBtn.disabled) return;

  // 初始化过程若曾被系统中断，在用户保存时自动重试一次。
  if (!window._dbReady) {
    try {
      await initDatabase();
    } catch (error) {
      window.showToast('数据库未就绪：' + (error.message || '初始化失败'));
      return;
    }
  }

  saveBtn.disabled = true;

  try {
    // 验证
    if (!validateForm()) {
      saveBtn.disabled = false;
      return;
    }

    // 收集表单数据
    const data = getFormData();

    // 去重检查（编辑模式排除自身）
    const existingId = await checkDuplicate(data, isEditMode ? editQsoId : null);
    if (existingId) {
      saveBtn.disabled = false;
      if (!confirm('该 QSO 已存在，是否覆盖？')) {
        return;
      }
      // 用户确认覆盖：直接更新已有记录
      await updateQso(existingId, data);
      if (isEditMode && editQsoId && editQsoId !== existingId) {
        await deleteQso(editQsoId);
      }
      window.showToast('QSO 已覆盖更新');
      queueAutomaticBackup();
      clearForm();
      return;
    }

    if (isEditMode && editQsoId) {
      await updateQso(editQsoId, data);
      window.showToast('更新成功');
    } else {
      await saveQso(data);
      window.showToast('保存成功');
    }

    queueAutomaticBackup();
    clearQsoDraft();
    clearForm();
  } catch (error) {
    window.showToast('保存失败：' + error.message);
  } finally {
    saveBtn.disabled = false;
  }
}

// ========== 删除 QSO ==========

async function handleDelete() {
  if (!isEditMode || !editQsoId) return;

  if (!confirm('确定要删除此 QSO 记录吗？此操作不可撤销。')) {
    return;
  }

  try {
    await deleteQso(editQsoId);
    window.showToast('已删除');
    queueAutomaticBackup();
    clearQsoDraft();
    clearForm();
  } catch (error) {
    window.showToast('删除失败：' + error.message);
  }
}

// ========== 清除表单 ==========

function handleClear() {
  if (isEditMode) {
    if (editIsDirty && !confirm('当前修改尚未保存，确定取消编辑吗？')) return;
    clearForm();
  } else {
    if (draftIsDirty && hasMeaningfulCurrentDraft() && !confirm('确定清空当前 QSO 表单和自动草稿吗？')) return;
    // 新建模式下清空所有输入
    document.querySelectorAll('input:not([type="hidden"]), textarea').forEach(el => {
      el.value = '';
    });
    document.querySelectorAll('select').forEach(el => {
      el.selectedIndex = 0;
    });
    renderAllowedBandOptions();
    refreshFieldPickers();
    hideCounterpartProfiles();
    updateRSTPlaceholders();
    setDefaultDateTime();
    resetQsoDraftBaseline();
    clearQsoDraft();
  }
}

function clearForm() {
  document.querySelectorAll('input:not([type="hidden"]), textarea').forEach(el => {
    el.value = '';
  });
  document.querySelectorAll('select').forEach(el => {
    el.selectedIndex = 0;
  });
  renderAllowedBandOptions();
  refreshFieldPickers();
  hideCounterpartProfiles();
  updateRSTPlaceholders();
  setDefaultDateTime();
  resetQsoDraftBaseline();
  clearQsoDraft();
  setEditMode(false, null);
}

// ========== GPS 定位 ==========

async function handleGetLocation() {
  const gpsBtn = document.getElementById('gps-btn');
  try {
    const position = await getCurrentPosition({ buttonEl: gpsBtn });
    document.getElementById('my-lat').value = position.lat.toFixed(6);
    document.getElementById('my-lon').value = position.lon.toFixed(6);

    if (position.alt !== null) {
      document.getElementById('my-alt').value = position.alt.toFixed(1);
    } else {
      document.getElementById('my-alt').value = '';
      window.showToast('当前位置已获取；设备未返回海拔，请手动输入');
    }

    // 自动计算网格
    autoCalcMyLocator();
    markQsoDraftDirty();
    if (position.alt !== null) window.showToast('位置和海拔获取成功');
  } catch (error) {
    window.showToast(error.message);
  }
}

// ========== 默认位置 ==========

function handleUseDefaultLocation() {
  const defaultQthStr = localStorage.getItem('hamlog_default_qth');
  if (!defaultQthStr) {
    window.showToast('请先在设置页保存默认位置');
    return;
  }

  try {
    const qth = JSON.parse(defaultQthStr);
    if (qth.lat != null) document.getElementById('my-lat').value = qth.lat;
    if (qth.lon != null) document.getElementById('my-lon').value = qth.lon;
    document.getElementById('my-alt').value = qth.alt ?? '';
    if (qth.locator) document.getElementById('my-locator').value = normalizeLocator(qth.locator);
    // 如果只有经纬度没有网格，自动计算
    if (qth.lat != null && qth.lon != null) {
      autoCalcMyLocator();
    }
    markQsoDraftDirty();
    window.showToast('已填充默认位置');
  } catch (e) {
    window.showToast('默认位置数据格式错误');
  }
}

// ========== 呼号查询 ==========

function updateCounterpartHistoryButtonState() {
  const button = document.getElementById('counterpart-history-btn');
  if (!button) return;
  button.hidden = isEditMode;
  button.disabled = isEditMode;
}

function hideCounterpartProfiles() {
  counterpartProfiles = [];
  const panel = document.getElementById('counterpart-profile-panel');
  const list = document.getElementById('counterpart-profile-list');
  if (panel) panel.hidden = true;
  if (list) list.replaceChildren();
}

async function handleCounterpartHistoryLookup() {
  if (isEditMode) return;
  const callsignInput = document.getElementById('callsign');
  const callsign = String(callsignInput?.value || '').trim().toUpperCase();
  if (!callsign) {
    window.showToast('请先输入完整呼号');
    callsignInput?.focus();
    return;
  }
  callsignInput.value = callsign;

  const button = document.getElementById('counterpart-history-btn');
  if (!button || button.disabled) return;
  const requestId = ++counterpartRequestId;
  button.disabled = true;
  button.textContent = '⏳';
  hideCounterpartProfiles();

  try {
    if (!window._dbReady) await initDatabase();
    const rows = await getCounterpartHistory(callsign, 50);
    if (requestId !== counterpartRequestId || callsign !== callsignInput.value.trim().toUpperCase() || isEditMode) return;

    counterpartProfiles = buildCounterpartProfiles(rows, 5);
    if (!counterpartProfiles.length) {
      window.showToast(`没有找到 ${callsign} 可复用的历史资料`);
      return;
    }
    renderCounterpartProfiles(callsign);
  } catch (error) {
    if (requestId === counterpartRequestId) {
      window.showToast('历史资料查询失败：' + (error.message || String(error)));
    }
  } finally {
    button.textContent = '🕘';
    button.disabled = isEditMode;
  }
}

function renderCounterpartProfiles(callsign) {
  const panel = document.getElementById('counterpart-profile-panel');
  const title = document.getElementById('counterpart-profile-title');
  const list = document.getElementById('counterpart-profile-list');
  if (!panel || !title || !list) return;

  title.textContent = `${callsign} 的历史资料（点击带入）`;
  list.replaceChildren();
  counterpartProfiles.forEach(profile => {
    const option = document.createElement('button');
    option.type = 'button';
    option.className = 'counterpart-profile-option';

    const meta = document.createElement('span');
    meta.className = 'counterpart-profile-option__meta';
    const date = formatDbDateForProfile(profile.qso_date);
    meta.textContent = `${date ? `最近使用 ${date}` : '历史资料'}${profile.recentUseCount > 1 ? ` · 近期重复 ${profile.recentUseCount} 次` : ''}`;

    const summary = document.createElement('span');
    summary.className = 'counterpart-profile-option__summary';
    summary.textContent = summarizeCounterpartProfile(profile);

    option.append(meta, summary);
    option.addEventListener('click', () => applyCounterpartProfile(profile));
    list.appendChild(option);
  });
  panel.hidden = false;
}

function formatDbDateForProfile(value) {
  const date = String(value || '');
  return /^\d{8}$/.test(date) ? `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}` : '';
}

function summarizeCounterpartProfile(profile) {
  const parts = [];
  if (profile.operator_name) parts.push(`姓名：${profile.operator_name}`);
  if (profile.qth) parts.push(`QTH：${profile.qth}`);
  if (profile.locator) parts.push(`网格：${profile.locator}`);
  if (profile.their_rig) parts.push(`设备：${profile.their_rig}`);
  if (profile.their_antenna) parts.push(`天线：${profile.their_antenna}`);
  if (profile.their_power) parts.push(`功率：${profile.their_power}`);
  return parts.join(' · ');
}

function applyCounterpartProfile(profile) {
  if (isEditMode) return;
  const fieldIds = {
    operator_name: 'op-name',
    qth: 'op-qth',
    locator: 'op-locator',
    their_rig: 'their-rig',
    their_antenna: 'their-antenna',
    their_power: 'their-power'
  };
  const values = getCounterpartProfileValues(profile);
  const conflicts = Object.entries(values).filter(([field, value]) => {
    const current = document.getElementById(fieldIds[field])?.value?.trim() || '';
    const comparableCurrent = field === 'locator' ? normalizeLocator(current) : current;
    return comparableCurrent && comparableCurrent !== value;
  });
  if (conflicts.length && !confirm('当前表单已有对方资料，确定用所选历史资料覆盖对应字段吗？')) return;

  for (const [field, value] of Object.entries(values)) {
    const input = document.getElementById(fieldIds[field]);
    if (input) input.value = field === 'locator' ? normalizeLocator(value) : value;
  }
  markQsoDraftDirty();
  hideCounterpartProfiles();
  window.showToast('已带入历史对方资料');
}

async function handleCallsignLookup() {
  const callsignInput = document.getElementById('callsign');
  const callsign = callsignInput.value.trim();
  if (!callsign) {
    window.showToast('请输入呼号');
    callsignInput.focus();
    return;
  }
  if (!navigator.onLine) {
    window.showToast('当前处于离线模式，无法查询呼号');
    return;
  }

  const lookupBtn = document.getElementById('lookup-btn');
  lookupBtn.textContent = '⏳';
  lookupBtn.disabled = true;

  try {
    const info = await queryCallsign(callsign);
    if (callsignInput.value.trim().toUpperCase() !== callsign.toUpperCase()) {
      window.showToast('呼号已变更，请重新查询');
      return;
    }
    if (info.name) document.getElementById('op-name').value = info.name;
    if (info.qth) document.getElementById('op-qth').value = info.qth;
    if (info.grid) document.getElementById('op-locator').value = normalizeLocator(info.grid);
    markQsoDraftDirty();
    window.showToast(info.warning ? `已填入资料；${info.warning}` : `${getCallbookLabel()} 查询成功`);
  } catch (error) {
    window.showToast(error.message);
  } finally {
    lookupBtn.textContent = '🔍';
    lookupBtn.disabled = false;
  }
}

// ========== 离线状态 ==========

function updateLookupButtonState() {
  const btn = document.getElementById('lookup-btn');
  if (!btn) return;
  btn.classList.toggle('is-offline', !navigator.onLine);
  const label = navigator.onLine ? `查询 ${getCallbookLabel()} 呼号信息` : '当前离线，无法查询呼号';
  btn.setAttribute('aria-label', label);
  btn.title = label;
}

function applyDetectedBand({ warnOnRestricted = true } = {}) {
  const frequency = document.getElementById('frequency')?.value;
  const band = detectBandFromFrequency(frequency);
  const bandSelect = document.getElementById('band');
  const hasOption = bandSelect && Array.from(bandSelect.options).some(option => option.value === band);
  if (band && hasOption) {
    bandSelect.value = band;
    lastRestrictedBandWarning = '';
  } else if (band && !isEditMode && !isBandAllowedForNewQso(band, currentOperatorClass)) {
    bandSelect.value = '';
    if (warnOnRestricted && lastRestrictedBandWarning !== band) {
      lastRestrictedBandWarning = band;
      window.showToast(`${band} 不在当前 ${currentOperatorClass} 类的新建频段选项中`);
    }
  } else if (!band) {
    lastRestrictedBandWarning = '';
  }
  refreshFieldPickers();
}

// ========== 网格自动计算 ==========

function setupLocatorAutoCalc() {
  const latInput = document.getElementById('my-lat');
  const lonInput = document.getElementById('my-lon');
  const locatorInputs = [
    document.getElementById('op-locator'),
    document.getElementById('my-locator')
  ];

  if (latInput) {
    latInput.addEventListener('blur', autoCalcMyLocator);
  }
  if (lonInput) {
    lonInput.addEventListener('blur', autoCalcMyLocator);
  }
  locatorInputs.forEach(input => {
    input?.addEventListener('blur', () => {
      input.value = normalizeLocator(input.value);
    });
  });
}

function autoCalcMyLocator() {
  const lat = parseFloat(document.getElementById('my-lat').value);
  const lon = parseFloat(document.getElementById('my-lon').value);
  const locatorInput = document.getElementById('my-locator');

  if (!isNaN(lat) && !isNaN(lon)) {
    try {
      locatorInput.value = latLngToLocator(lat, lon);
    } catch (e) {
      // 计算失败则保留原有值
    }
  }
}

// ========== 表单验证 ==========

function validateForm() {
  // 呼号必填
  const callsign = document.getElementById('callsign').value.trim();
  if (!callsign) {
    window.showToast('请输入呼号');
    document.getElementById('callsign').focus();
    return false;
  }

  // 频率必须 > 0
  const freq = parseFloat(document.getElementById('frequency').value);
  if (!Number.isFinite(freq) || freq <= 0) {
    window.showToast('请输入有效频率');
    document.getElementById('frequency').focus();
    return false;
  }

  // 日期格式 YY/MM/DD
  const date = document.getElementById('qso-date').value.trim();
  if (!isValidDisplayDate(date)) {
    window.showToast('请输入有效的 UTC 日期（YY/MM/DD）');
    document.getElementById('qso-date').focus();
    return false;
  }

  // 时间格式 HH:MM:SS
  const timeOn = document.getElementById('time-on').value.trim();
  if (!isValidDisplayTime(timeOn)) {
    window.showToast('请输入有效的打开时间（HH:MM:SS）');
    document.getElementById('time-on').focus();
    return false;
  }

  const timeOff = document.getElementById('time-off').value.trim();
  if (!isValidDisplayTime(timeOff)) {
    window.showToast('请输入有效的关闭时间（HH:MM:SS）');
    document.getElementById('time-off').focus();
    return false;
  }

  // RST 格式验证（按模式）
  const mode = document.getElementById('mode').value;
  const band = document.getElementById('band').value;
  if (!mode) {
    window.showToast('请选择通联模式');
    focusFieldPicker('mode');
    return false;
  }
  if (!band) {
    window.showToast('请选择频段');
    focusFieldPicker('band');
    return false;
  }
  if (!isEditMode && !isBandAllowedForNewQso(band, currentOperatorClass)) {
    window.showToast(`${currentOperatorClass} 类不能用该频段新建 QSO，请重新选择`);
    focusFieldPicker('band');
    return false;
  }
  const rstSent = document.getElementById('rst-sent').value.trim();
  const rstRcvd = document.getElementById('rst-rcvd').value.trim();

  if (rstSent && !validateRST(rstSent, mode)) {
    window.showToast('我方发送的 RST 格式不正确');
    document.getElementById('rst-sent').focus();
    return false;
  }
  if (rstRcvd && !validateRST(rstRcvd, mode)) {
    window.showToast('我方接收的 RST 格式不正确');
    document.getElementById('rst-rcvd').focus();
    return false;
  }

  const latText = document.getElementById('my-lat').value.trim();
  const lonText = document.getElementById('my-lon').value.trim();
  if (latText && (!Number.isFinite(Number(latText)) || Number(latText) < -90 || Number(latText) > 90)) {
    window.showToast('纬度范围应为 -90 至 90');
    document.getElementById('my-lat').focus();
    return false;
  }
  if (lonText && (!Number.isFinite(Number(lonText)) || Number(lonText) < -180 || Number(lonText) > 180)) {
    window.showToast('经度范围应为 -180 至 180');
    document.getElementById('my-lon').focus();
    return false;
  }
  const altText = document.getElementById('my-alt').value.trim();
  if (altText && !Number.isFinite(Number(altText))) {
    window.showToast('海拔应填写数字，或留空');
    document.getElementById('my-alt').focus();
    return false;
  }

  const theirLocator = normalizeLocator(document.getElementById('op-locator').value);
  if (theirLocator && !isValidLocator(theirLocator)) {
    window.showToast('对方网格坐标应为 4 位或 6 位 Maidenhead 格式');
    document.getElementById('op-locator').focus();
    return false;
  }

  const myLocator = normalizeLocator(document.getElementById('my-locator').value);
  if (myLocator && !isValidLocator(myLocator)) {
    window.showToast('我的网格坐标应为 4 位或 6 位 Maidenhead 格式');
    document.getElementById('my-locator').focus();
    return false;
  }

  return true;
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

function isValidDisplayTime(value) {
  const match = /^(\d{2}):(\d{2}):(\d{2})$/.exec(value);
  return !!match && Number(match[1]) <= 23 && Number(match[2]) <= 59 && Number(match[3]) <= 59;
}

/**
 * RST 格式验证：FT8/FT4 接受信噪比报告，CW/RTTY 接受三位 RST，语音模式接受两位 RS。
 */
function validateRST(rst, mode) {
  if (!rst) return true; // 可选字段，空值通过
  const normalizedMode = mode.toUpperCase();
  if (['FT8', 'FT4'].includes(normalizedMode)) return /^(?:[+-]?\d{1,2}|\d{3})$/.test(rst);
  if (['CW', 'RTTY'].includes(normalizedMode)) return /^\d{1,3}$/.test(rst);
  return /^\d{1,2}$/.test(rst);
}

function updateRSTPlaceholders() {
  const mode = document.getElementById('mode').value.toUpperCase();
  const placeholder = ['FT8', 'FT4'].includes(mode) ? '-12' : ['CW', 'RTTY'].includes(mode) ? '599' : '59';
  document.getElementById('rst-sent').placeholder = placeholder;
  document.getElementById('rst-rcvd').placeholder = placeholder;
}

// ========== 获取表单数据 ==========

function getFormData() {
  return {
    callsign: document.getElementById('callsign').value.trim().toUpperCase(),
    operator_name: document.getElementById('op-name').value.trim(),
    qth: document.getElementById('op-qth').value.trim(),
    locator: normalizeLocator(document.getElementById('op-locator').value),
    rst_sent: document.getElementById('rst-sent').value.trim(),
    rst_rcvd: document.getElementById('rst-rcvd').value.trim(),
    qsl_considered: document.getElementById('qsl-considered').value === '1' ? 1 : 0,
    mode: document.getElementById('mode').value,
    band: document.getElementById('band').value,
    frequency: Number(document.getElementById('frequency').value),
    qso_date: window.displayDateToDb(document.getElementById('qso-date').value.trim()),
    time_on: window.displayTimeToDb(document.getElementById('time-on').value.trim()),
    time_off: window.displayTimeToDb(document.getElementById('time-off').value.trim()),
    my_lat: finiteNumberOrNull(document.getElementById('my-lat').value),
    my_lon: finiteNumberOrNull(document.getElementById('my-lon').value),
    my_alt: finiteNumberOrNull(document.getElementById('my-alt').value),
    my_locator: normalizeLocator(document.getElementById('my-locator').value),
    my_power: document.getElementById('my-power').value.trim() || null,
    my_rig: document.getElementById('my-rig').value.trim() || null,
    my_antenna: null,
    their_power: document.getElementById('their-power').value.trim() || null,
    their_rig: document.getElementById('their-rig').value.trim(),
    their_antenna: document.getElementById('their-antenna').value.trim(),
    notes: document.getElementById('notes').value.trim(),
    station_callsign: (localStorage.getItem('hamlog_station_callsign') || '').trim().toUpperCase()
  };
}

function finiteNumberOrNull(value) {
  if (String(value).trim() === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
