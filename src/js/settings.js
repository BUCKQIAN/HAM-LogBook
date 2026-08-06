/* ============================================================
   settings.js - 设置页（settings.html）逻辑
   - 默认 QTH 保存/加载
   - HamQTH 账号保存/加载
   - ADIF 导出到文件
   - ADIF 导入（FileReader 解析 + 去重插入）
   - ADIF 分享（文件分享 or 文本降级）
   - 关于信息
   ============================================================ */

import { initDatabase, getAllQsos, getQsoById, saveQso, updateQso, checkDuplicate } from './db.js';
import { generateADIF, parseADIF } from './adif.js';
import { latLngToLocator, isValidLocator, normalizeLocator } from './locator.js';
import { detectBandFromFrequency, SUPPORTED_BANDS } from './radio.js';
import { getSplashStyle, renderSplashStyleOptions, syncNativeSplashStyle } from './splash.js';

// ========== 页面初始化 ==========

export async function initPage() {
  loadSettings();
  bindEvents();
  setupSplashStyle();

  try {
    await initDatabase();
  } catch (error) {
    console.error('设置页数据库初始化失败:', error);
    // 设置保存到 localStorage 仍可用，仅 ADIF 导入导出不可用
  }
}

function setupSplashStyle() {
  const container = document.getElementById('splash-style-options');
  const selected = getSplashStyle();
  void syncNativeSplashStyle(selected);
  renderSplashStyleOptions(container, selected, style => {
    window.showToast(`原生启动页已切换为方案 ${style}，下次启动生效`);
  });
}

// ========== 加载已保存设置 ==========

function loadSettings() {
  // 默认 QTH
  const qthStr = localStorage.getItem('hamlog_default_qth');
  if (qthStr) {
    try {
      const qth = JSON.parse(qthStr);
      if (qth.lat != null) document.getElementById('default-lat').value = qth.lat;
      if (qth.lon != null) document.getElementById('default-lon').value = qth.lon;
      if (qth.alt != null) document.getElementById('default-alt').value = qth.alt;
      if (qth.locator) document.getElementById('default-locator').value = normalizeLocator(qth.locator);
    } catch (e) { /* ignore */ }
  }

  // HamQTH 账号
  const user = localStorage.getItem('hamlog_hamqth_user');
  const pass = localStorage.getItem('hamlog_hamqth_pass');
  if (user) document.getElementById('hamqth-user').value = user;
  if (pass) document.getElementById('hamqth-pass').value = pass;

  const stationCallsign = localStorage.getItem('hamlog_station_callsign');
  if (stationCallsign) document.getElementById('station-callsign').value = stationCallsign;

  // 我的设备预设
  const rigsStr = localStorage.getItem('hamlog_my_rigs');
  if (rigsStr) {
    try {
      const rigs = JSON.parse(rigsStr);
      if (Array.isArray(rigs)) {
        document.getElementById('my-rigs-input').value = rigs.join('\n');
      }
    } catch (e) { /* ignore */ }
  }
}

// ========== 事件绑定 ==========

function bindEvents() {
  document.getElementById('save-station-btn')?.addEventListener('click', saveStationProfile);
  // 保存默认位置
  const saveQthBtn = document.getElementById('save-qth-btn');
  if (saveQthBtn) {
    saveQthBtn.addEventListener('click', saveDefaultQTH);
  }

  // 自动计算网格
  const qthLat = document.getElementById('default-lat');
  const qthLon = document.getElementById('default-lon');
  if (qthLat) qthLat.addEventListener('blur', autoCalcDefaultLocator);
  if (qthLon) qthLon.addEventListener('blur', autoCalcDefaultLocator);
  document.getElementById('default-locator')?.addEventListener('blur', event => {
    event.currentTarget.value = normalizeLocator(event.currentTarget.value);
  });

  // 保存 HamQTH 账号
  const saveAccountBtn = document.getElementById('save-account-btn');
  if (saveAccountBtn) {
    saveAccountBtn.addEventListener('click', saveHamQTHCredentials);
  }

  // 导出 ADIF
  const exportBtn = document.getElementById('export-adif-btn');
  if (exportBtn) {
    exportBtn.addEventListener('click', handleExport);
  }

  // 导入 ADIF
  const importInput = document.getElementById('adif-file');
  if (importInput) {
    importInput.addEventListener('change', handleImport);
  }

  // 保存设备预设
  const saveRigsBtn = document.getElementById('save-rigs-btn');
  if (saveRigsBtn) {
    saveRigsBtn.addEventListener('click', saveRigPresets);
  }

  // 分享 ADIF
  const shareBtn = document.getElementById('share-adif-btn');
  if (shareBtn) {
    shareBtn.addEventListener('click', handleShare);
  }
}

// ========== 自动计算网格 ==========

function autoCalcDefaultLocator() {
  const lat = parseFloat(document.getElementById('default-lat').value);
  const lon = parseFloat(document.getElementById('default-lon').value);
  const locatorInput = document.getElementById('default-locator');

  if (!isNaN(lat) && !isNaN(lon) && locatorInput) {
    try {
      locatorInput.value = latLngToLocator(lat, lon);
    } catch (e) { /* ignore */ }
  }
}

// ========== 保存默认 QTH ==========

function saveDefaultQTH() {
  const latText = document.getElementById('default-lat').value.trim();
  const lonText = document.getElementById('default-lon').value.trim();
  const altText = document.getElementById('default-alt').value.trim();
  const lat = finiteNumberOrNull(latText);
  const lon = finiteNumberOrNull(lonText);
  const alt = finiteNumberOrNull(altText);

  if (latText && (lat === null || lat < -90 || lat > 90)) {
    window.showToast('纬度范围应为 -90 至 90');
    return;
  }
  if (lonText && (lon === null || lon < -180 || lon > 180)) {
    window.showToast('经度范围应为 -180 至 180');
    return;
  }
  if (altText && alt === null) {
    window.showToast('海拔应填写数字，或留空');
    return;
  }
  let locator = normalizeLocator(document.getElementById('default-locator').value);
  if (!locator && lat !== null && lon !== null) locator = latLngToLocator(lat, lon);
  if (locator && !isValidLocator(locator)) {
    window.showToast('网格坐标应为 4 位或 6 位 Maidenhead 格式');
    return;
  }

  const data = {
    lat,
    lon,
    alt,
    locator
  };

  localStorage.setItem('hamlog_default_qth', JSON.stringify(data));
  window.showToast('默认位置已保存');
}

// ========== 保存设备预设 ==========

function saveRigPresets() {
  const text = document.getElementById('my-rigs-input').value.trim();
  const rigs = text ? [...new Set(text.split('\n').map(s => s.trim()).filter(Boolean))].slice(0, 30) : [];
  document.getElementById('my-rigs-input').value = rigs.join('\n');
  localStorage.setItem('hamlog_my_rigs', JSON.stringify(rigs));
  window.showToast('设备列表已保存（共 ' + rigs.length + ' 台）');
}

// ========== 保存 HamQTH 账号 ==========

function saveHamQTHCredentials() {
  const username = document.getElementById('hamqth-user').value.trim();
  const password = document.getElementById('hamqth-pass').value;

  localStorage.setItem('hamlog_hamqth_user', username);
  localStorage.setItem('hamlog_hamqth_pass', password);
  // 清除旧的 session，下次查询时会用新账号重新登录
  localStorage.removeItem('hamlog_hamqth_session');
  window.showToast(username && password ? 'HamQTH 账号已保存' : 'HamQTH 账号已清除；离线记录不受影响');
}

function saveStationProfile() {
  const callsign = document.getElementById('station-callsign').value.trim().toUpperCase();
  localStorage.setItem('hamlog_station_callsign', callsign);
  document.getElementById('station-callsign').value = callsign;
  window.showToast(callsign ? '台站呼号已保存，将写入 ADIF' : '台站呼号已清除');
}

// ========== 导出 ADIF ==========

async function handleExport() {
  const exportBtn = document.getElementById('export-adif-btn');
  exportBtn.disabled = true;

  try {
    await ensureDatabase();
    // 1. 获取所有 QSO
    const qsos = await getAllQsos();
    if (qsos.length === 0) {
      window.showToast('没有可导出的 QSO 记录');
      exportBtn.disabled = false;
      return;
    }

    // 2. 生成 ADIF 文本
    const adifContent = generateADIF(qsos);
    const filename = `ham-logbook_${window.getExportDateString()}.adi`;

    // 3. 写入文件（使用 Filesystem 插件）
    try {
      var Filesystem = window.FilesystemPlugin, Directory = window.FilesystemDirectory, Encoding = window.FilesystemEncoding;

      // 确保目录存在
      await ensureExportDirectory(Filesystem, Directory);
      await Filesystem.writeFile({
        path: `ham-logbook/${filename}`,
        data: adifContent,
        directory: Directory.Data,
        encoding: Encoding.UTF8
      });

      window.showToast(`已导出 ham-logbook/${filename}`);
    } catch (fsError) {
      console.error('文件写入失败:', fsError);
      window.showToast('导出失败：' + (fsError.message || String(fsError)));
    }
  } catch (error) {
    window.showToast('导出失败：' + error.message);
  } finally {
    exportBtn.disabled = false;
  }
}

// ========== 导入 ADIF ==========

async function handleImport(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = async (e) => {
    const adifText = e.target.result;
    try {
      await ensureDatabase();
      const qsos = parseADIF(adifText);
      if (qsos.length === 0) {
        window.showToast('未在文件中找到有效的 QSO 记录');
        return;
      }

      let imported = 0;
      let skipped = 0;
      let overwritten = 0;
      let invalid = 0;

      for (const rawQso of qsos) {
        const qso = normalizeImportedQso(rawQso);
        if (!qso) {
          invalid++;
          continue;
        }
        // 去重检查
        const existingId = await checkDuplicate(qso);
        if (existingId) {
          if (confirm(`呼号 ${qso.callsign} 于 ${qso.qso_date} 的 QSO 已存在，是否覆盖？`)) {
            // 只用导入文件实际包含的字段覆盖，保留本地扩展信息。
            const existing = await getQsoById(existingId);
            await updateQso(existingId, { ...existing, ...qso });
            overwritten++;
          } else {
            skipped++;
          }
        } else {
          await saveQso(qso);
          imported++;
        }
      }

      window.showToast(`导入完成：新增 ${imported}，覆盖 ${overwritten}，跳过 ${skipped}，无效 ${invalid}`);
    } catch (error) {
      window.showToast('导入失败：' + error.message);
    }
  };

  reader.onerror = () => {
    window.showToast('文件读取失败');
  };

  reader.readAsText(file);

  // 清空 file input，允许重复选择同一文件
  event.target.value = '';
}

// ========== 分享 ADIF ==========

async function handleShare() {
  const shareBtn = document.getElementById('share-adif-btn');
  shareBtn.disabled = true;

  try {
    await ensureDatabase();
    const qsos = await getAllQsos();
    if (qsos.length === 0) {
      window.showToast('没有可分享的 QSO 记录');
      shareBtn.disabled = false;
      return;
    }

    const adifContent = generateADIF(qsos);
    const filename = `ham-logbook_${window.getExportDateString()}.adi`;

    try {
      // 方案 1: 写入文件后分享文件
      var Filesystem = window.FilesystemPlugin, Directory = window.FilesystemDirectory, Encoding = window.FilesystemEncoding;
      var Share = window.SharePlugin;

      await ensureExportDirectory(Filesystem, Directory);
      await Filesystem.writeFile({
        path: `ham-logbook/${filename}`,
        data: adifContent,
        directory: Directory.Data,
        encoding: Encoding.UTF8
      });

      const fileUriResult = await Filesystem.getUri({
        path: `ham-logbook/${filename}`,
        directory: Directory.Data
      });

      await Share.share({
        files: [fileUriResult.uri],
        title: '分享 ADIF 日志'
      });
    } catch (shareError) {
      // 方案 2: 降级为文本分享
      console.warn('文件分享失败，降级为文本分享:', shareError);
      try {
        var Share = window.SharePlugin;
        await Share.share({
          text: adifContent,
          title: '分享 ADIF 日志'
        });
      } catch (textShareError) {
        window.showToast('分享失败：' + (textShareError.message || String(textShareError)));
      }
    }
  } catch (error) {
    window.showToast('分享失败：' + error.message);
  } finally {
    shareBtn.disabled = false;
  }
}

function normalizeImportedQso(raw) {
  const qso = { ...raw };
  qso.callsign = String(qso.callsign || '').trim().toUpperCase();
  qso.qso_date = String(qso.qso_date || '').replace(/\D/g, '');
  qso.time_on = String(qso.time_on || '').replace(/\D/g, '');
  if (qso.time_on.length === 4) qso.time_on += '00';
  if (qso.time_off) {
    qso.time_off = String(qso.time_off).replace(/\D/g, '');
    if (qso.time_off.length === 4) qso.time_off += '00';
  }
  if (!qso.band && qso.frequency != null) qso.band = detectBandFromFrequency(qso.frequency);
  qso.mode = String(qso.mode || '').trim().toUpperCase();
  qso.band = String(qso.band || '').trim().toLowerCase();
  if (qso.locator) {
    qso.locator = normalizeLocator(qso.locator);
    if (!isValidLocator(qso.locator)) qso.locator = '';
  }
  if (qso.my_locator) {
    qso.my_locator = normalizeLocator(qso.my_locator);
    if (!isValidLocator(qso.my_locator)) qso.my_locator = '';
  }

  if (!qso.callsign || !isValidDbDate(qso.qso_date) || !isValidDbTime(qso.time_on) || !SUPPORTED_BANDS.includes(qso.band) || !qso.mode) {
    return null;
  }
  return qso;
}

function finiteNumberOrNull(value) {
  if (String(value).trim() === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function isValidDbDate(value) {
  if (!/^\d{8}$/.test(value)) return false;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(4, 6));
  const day = Number(value.slice(6, 8));
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function isValidDbTime(value) {
  return /^\d{6}$/.test(value)
    && Number(value.slice(0, 2)) <= 23
    && Number(value.slice(2, 4)) <= 59
    && Number(value.slice(4, 6)) <= 59;
}

async function ensureDatabase() {
  if (!window._dbReady) await initDatabase();
}

async function ensureExportDirectory(filesystem, directory) {
  if (!filesystem || typeof filesystem.mkdir !== 'function' || typeof filesystem.writeFile !== 'function') {
    throw new Error('文件系统插件不可用');
  }
  try {
    await filesystem.mkdir({ path: 'ham-logbook', directory: directory.Data, recursive: true });
  } catch (error) {
    const message = error?.message || String(error || '');
    // 只有“目录已存在”可以安全忽略；权限及磁盘错误必须反馈给用户。
    if (!/exist|already/i.test(message)) throw error;
  }
}
