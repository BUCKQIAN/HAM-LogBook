/* ============================================================
   app.js - 新建/编辑 QSO 页（index.html）逻辑
   - 表单填充、验证、保存/更新/删除
   - GPS 定位、呼号查询、默认位置
   - 中继台预设频率读取
   ============================================================ */

import { initDatabase, saveQso, updateQso, getQsoById, deleteQso, checkDuplicate } from './db.js';
import { getCurrentPosition } from './gps.js';
import { latLngToLocator, isValidLocator, normalizeLocator } from './locator.js';
import { queryCallsign } from './hamqth.js';
import { detectBandFromFrequency } from './radio.js';
import { getSplashStyle, hideNativeSplash, syncNativeSplashStyle } from './splash.js';

// ========== 页面状态 ==========
let isEditMode = false;
let editQsoId = null;

// ========== 页面初始化 ==========

/**
 * 初始化页面（DOMContentLoaded 时调用）
 */
export async function initPage() {
  // 先绑定所有事件（不依赖数据库，确保始终可用）
  bindEvents();
  setupLocatorAutoCalc();
  updateLookupButtonState();
  window.addEventListener('online', updateLookupButtonState);
  window.addEventListener('offline', updateLookupButtonState);

  // 设置默认日期时间（纯 JS，不依赖数据库）
  setDefaultDateTime();

  // 加载设备预设列表（从 localStorage）
  loadRigPresets();

  // 中继台预设同样只依赖 localStorage，不应受数据库状态影响。
  checkRepeaterPreset();

  // 迁移旧版本保存在 localStorage 的选择，并在网页首帧后关闭真正的原生启动页。
  void syncNativeSplashStyle(getSplashStyle());
  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(() => void hideNativeSplash());
  });

  // 尝试初始化数据库（失败不阻断其他功能）
  try {
    await initDatabase();
    // 以下依赖数据库的操作
    const urlParams = new URLSearchParams(window.location.search);
    const editId = urlParams.get('edit');
    if (editId) {
      try {
        await loadQsoForEdit(parseInt(editId, 10));
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
  try {
    const rigsStr = localStorage.getItem('hamlog_my_rigs');
    if (!rigsStr) return;
    const rigs = JSON.parse(rigsStr);
    if (!Array.isArray(rigs) || rigs.length === 0) return;
    const datalist = document.getElementById('my-rigs-list');
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
  document.getElementById('mode').value = qso.mode || 'FM';
  updateRSTPlaceholders();
  document.getElementById('band').value = qso.band || '';
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
  document.getElementById('notes').value = qso.notes || '';

  // 旧记录没有保存网格时，根据经纬度补算。
  if (!qso.my_locator) autoCalcMyLocator();
}

function setEditMode(enabled, qsoId = null) {
  isEditMode = enabled;
  editQsoId = qsoId;

  const saveBtn = document.getElementById('save-btn');
  const deleteBtn = document.getElementById('delete-btn');
  const clearBtn = document.getElementById('clear-btn');

  if (enabled) {
    saveBtn.innerHTML = '💾 更新 QSO';
    deleteBtn.style.display = 'flex';
    clearBtn.textContent = '取消编辑';
    document.documentElement.dataset.editId = qsoId;
  } else {
    saveBtn.innerHTML = '💾 保存 QSO';
    deleteBtn.style.display = 'none';
    clearBtn.textContent = '清除表单';
    delete document.documentElement.dataset.editId;
    window.history.replaceState({}, '', window.location.pathname);
  }
}

// ========== 事件绑定 ==========

function bindEvents() {
  document.getElementById('save-btn').addEventListener('click', handleSave);
  document.getElementById('delete-btn').addEventListener('click', handleDelete);
  document.getElementById('clear-btn').addEventListener('click', handleClear);
  document.getElementById('gps-btn').addEventListener('click', handleGetLocation);
  document.getElementById('default-loc-btn').addEventListener('click', handleUseDefaultLocation);
  document.getElementById('lookup-btn').addEventListener('click', handleCallsignLookup);
  document.getElementById('utc-time-btn').addEventListener('click', handleRefreshUTCTime);

  // 频率录入完成后自动识别常用业余频段，仍允许用户手动调整。
  const frequencyInput = document.getElementById('frequency');
  frequencyInput.addEventListener('change', applyDetectedBand);
  frequencyInput.addEventListener('blur', applyDetectedBand);

  document.getElementById('mode').addEventListener('change', updateRSTPlaceholders);
  updateRSTPlaceholders();
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
    clearForm();
  } catch (error) {
    window.showToast('删除失败：' + error.message);
  }
}

// ========== 清除表单 ==========

function handleClear() {
  if (isEditMode) {
    clearForm();
  } else {
    // 新建模式下清空所有输入
    document.querySelectorAll('input:not([type="hidden"]), textarea').forEach(el => {
      el.value = '';
    });
    document.querySelectorAll('select').forEach(el => {
      el.selectedIndex = 0;
    });
    updateRSTPlaceholders();
    setDefaultDateTime();
  }
}

function clearForm() {
  document.querySelectorAll('input:not([type="hidden"]), textarea').forEach(el => {
    el.value = '';
  });
  document.querySelectorAll('select').forEach(el => {
    el.selectedIndex = 0;
  });
  updateRSTPlaceholders();
  setDefaultDateTime();
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
    window.showToast('已填充默认位置');
  } catch (e) {
    window.showToast('默认位置数据格式错误');
  }
}

// ========== 呼号查询 ==========

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
    if (info.name) document.getElementById('op-name').value = info.name;
    if (info.qth) document.getElementById('op-qth').value = info.qth;
    if (info.grid) document.getElementById('op-locator').value = normalizeLocator(info.grid);
    window.showToast('查询成功');
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
  btn.setAttribute('aria-label', navigator.onLine ? '查询 HamQTH 呼号信息' : '当前离线，无法查询呼号');
}

function applyDetectedBand() {
  const frequency = document.getElementById('frequency')?.value;
  const band = detectBandFromFrequency(frequency);
  const bandSelect = document.getElementById('band');
  if (band && bandSelect && bandSelect.querySelector(`option[value="${band}"]`)) {
    bandSelect.value = band;
  }
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
  if (!band) {
    window.showToast('请选择频段');
    document.getElementById('band').focus();
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
