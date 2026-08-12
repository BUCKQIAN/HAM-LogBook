/* ============================================================
   settings.js - 设置页（settings.html）逻辑
   - 默认 QTH 保存/加载
   - HamQTH 账号保存/加载
   - ADIF 导出到文件
   - ADIF 导入（FileReader 解析 + 去重插入）
   - ADIF 分享（文件分享 or 文本降级）
   - 关于信息
   ============================================================ */

import {
  initDatabase,
  getQsoExportPage,
  importQsoBatch,
  beginQsoImport,
  commitQsoImport,
  rollbackQsoImport,
  getAllRepeaters,
  replaceAllRepeaters
} from './db.js';
import { generateADIFHeader, generateADIFRecords, parseADIFFile } from './adif.js';
import { latLngToLocator, isValidLocator, normalizeLocator } from './locator.js';
import { detectBandFromFrequency, isValidTone, normalizeTone, SUPPORTED_BANDS } from './radio.js';
import { getSplashStyle, renderSplashStyleOptions, syncNativeSplashStyle } from './splash.js';
import {
  CN_OPERATOR_CLASS_KEY,
  getStoredCnOperatorClass,
  isValidCnOperatorClass,
  storeCnOperatorClass
} from './operator-license.js';
import { loadHamQthCredentials, saveHamQthCredentials } from './secure-data.js';
import {
  isAutomaticBackupEnabled,
  maybeCreateAutomaticBackup,
  setAutomaticBackupEnabled
} from './automatic-backup.js';
import {
  decryptPersonalInfoBackup,
  encryptPersonalInfoBackup,
  isEncryptedPersonalInfoBackup
} from './backup-crypto.js';

const APP_VERSION = '1.1.0';
const PERSONAL_INFO_FORMAT = 'hamlogbook-personal-info';
const PERSONAL_INFO_SCHEMA_VERSION = 3;
const HAMQTH_USER_HINT_KEY = 'hamlog_hamqth_user_hint';
const MAX_PERSONAL_INFO_FILE_SIZE = 2 * 1024 * 1024;
const MAX_ADIF_FILE_SIZE = 256 * 1024 * 1024;
const MAX_ADIF_RECORDS = 1000000;
const ADIF_EXPORT_BATCH_SIZE = 250;
const ADIF_IMPORT_BATCH_SIZE = 100;
const TEXT_SHARE_RECORD_LIMIT = 500;
let activeDataOperation = '';

// ========== 页面初始化 ==========

export async function initPage() {
  await loadSettings();
  bindEvents();
  setupSplashStyle();
  const dataPage = document.body.dataset.settingsPage === 'data';
  if (!dataPage) return;

  void refreshExportFolderStatus();

  try {
    await initDatabase();
  } catch (error) {
    console.error('设置页数据库初始化失败:', error);
    // 设置保存到 localStorage 仍可用，仅 ADIF 导入导出不可用
  }
}

function setupSplashStyle() {
  const container = document.getElementById('splash-style-options');
  if (!container) return;
  const selected = getSplashStyle();
  void syncNativeSplashStyle(selected);
  renderSplashStyleOptions(container, selected, (style, result) => {
    if (result.error) {
      window.showToast(`方案 ${style} 已保存在网页端，但原生同步失败，请重启后重试`, 4000);
    } else {
      window.showToast(`方案 ${style} 已保存；下次启动将显示该方案`);
    }
  });
}

// ========== 加载已保存设置 ==========

async function loadSettings() {
  // 先清空表单，确保恢复空值时不会残留恢复前的内容。
  [
    'default-lat',
    'default-lon',
    'default-alt',
    'default-locator',
    'hamqth-user',
    'hamqth-pass',
    'station-callsign',
    'my-rigs-input'
  ].forEach(id => {
    const element = document.getElementById(id);
    if (element) element.value = '';
  });

  // 默认 QTH
  const qthStr = localStorage.getItem('hamlog_default_qth');
  if (qthStr) {
    try {
      const qth = JSON.parse(qthStr);
      if (qth.lat != null) setElementValue('default-lat', qth.lat);
      if (qth.lon != null) setElementValue('default-lon', qth.lon);
      if (qth.alt != null) setElementValue('default-alt', qth.alt);
      if (qth.locator) setElementValue('default-locator', normalizeLocator(qth.locator));
    } catch (e) { /* ignore */ }
  }

  // 密码仅从 Android Keystore 安全存储读取；迁移备份可以只恢复用户名提示。
  let credentials = { username: '', password: '' };
  try {
    credentials = await loadHamQthCredentials();
  } catch (error) {
    console.warn('读取 HamQTH 安全凭据失败:', error);
  }
  const user = credentials.username || localStorage.getItem(HAMQTH_USER_HINT_KEY) || '';
  const pass = credentials.password;
  if (user) setElementValue('hamqth-user', user);
  if (pass) setElementValue('hamqth-pass', pass);

  const stationCallsign = localStorage.getItem('hamlog_station_callsign');
  if (stationCallsign) setElementValue('station-callsign', stationCallsign);
  const operatorClassSelect = document.getElementById('operator-class');
  if (operatorClassSelect) operatorClassSelect.value = getStoredCnOperatorClass();
  const autoBackupInput = document.getElementById('auto-backup-enabled');
  if (autoBackupInput) autoBackupInput.checked = isAutomaticBackupEnabled();

  // 我的设备预设
  const rigsStr = localStorage.getItem('hamlog_my_rigs');
  if (rigsStr) {
    try {
      const rigs = JSON.parse(rigsStr);
      if (Array.isArray(rigs)) {
        setElementValue('my-rigs-input', rigs.join('\n'));
      }
    } catch (e) { /* ignore */ }
  }
}

function setElementValue(id, value) {
  const element = document.getElementById(id);
  if (element) element.value = value == null ? '' : String(value);
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

  const chooseExportFolderBtn = document.getElementById('choose-export-folder-btn');
  if (chooseExportFolderBtn) {
    chooseExportFolderBtn.addEventListener('click', handleChooseExportFolder);
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

  document.getElementById('export-personal-info-btn')?.addEventListener('click', handleExportPersonalInfo);
  document.getElementById('personal-info-file')?.addEventListener('change', handleRestorePersonalInfo);
  document.getElementById('auto-backup-enabled')?.addEventListener('change', handleAutomaticBackupToggle);

  document.querySelectorAll('.bottom-nav a, .settings-back-link').forEach(link => {
    link.addEventListener('click', event => {
      if (!activeDataOperation) return;
      event.preventDefault();
      window.showToast(`${activeDataOperation}尚未完成，请稍候`, 3000);
    });
  });
}

async function handleAutomaticBackupToggle(event) {
  const input = event.currentTarget;
  if (!input.checked) {
    setAutomaticBackupEnabled(false);
    window.showToast('自动 ADIF 备份已关闭');
    return;
  }
  if (!beginDataOperation('自动备份设置')) {
    input.checked = false;
    return;
  }
  input.disabled = true;
  try {
    const plugin = getAdifFileManager();
    const folder = await ensureExportFolder(plugin);
    if (!folder) {
      input.checked = false;
      return;
    }
    setAutomaticBackupEnabled(true);
    await ensureDatabase();
    const result = await maybeCreateAutomaticBackup({ force: true });
    window.showToast(result.created
      ? `自动备份已开启，并已保存 ${result.count} 条日志；仅保留最近 7 份`
      : '自动备份已开启；保存第一条 QSO 后将生成备份', 5000);
  } catch (error) {
    setAutomaticBackupEnabled(false);
    input.checked = false;
    window.showToast('无法开启自动备份：' + (error.message || String(error)), 5000);
  } finally {
    input.disabled = false;
    endDataOperation();
  }
}

function beginDataOperation(label) {
  if (activeDataOperation) {
    window.showToast(`${activeDataOperation}尚未完成，请稍候`, 3000);
    return false;
  }
  activeDataOperation = label;
  return true;
}

function endDataOperation() {
  activeDataOperation = '';
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

async function saveHamQTHCredentials() {
  const button = document.getElementById('save-account-btn');
  const username = document.getElementById('hamqth-user').value.trim();
  const password = document.getElementById('hamqth-pass').value;
  if ((username && !password) || (!username && password)) {
    window.showToast('用户名和密码需要同时填写；两项都留空可清除账号');
    return;
  }
  if (button) button.disabled = true;
  try {
    await saveHamQthCredentials(username, password);
    sessionStorage.removeItem('hamlog_hamqth_session');
    window.showToast(username && password ? 'HamQTH 账号已加密保存' : 'HamQTH 账号已清除；离线记录不受影响');
  } catch (error) {
    window.showToast('安全保存 HamQTH 账号失败：' + (error.message || String(error)));
  } finally {
    if (button) button.disabled = false;
  }
}

function saveStationProfile() {
  const callsign = document.getElementById('station-callsign').value.trim().toUpperCase();
  const operatorClass = storeCnOperatorClass(document.getElementById('operator-class')?.value);
  localStorage.setItem('hamlog_station_callsign', callsign);
  document.getElementById('station-callsign').value = callsign;
  window.showToast(callsign
    ? `台站资料已保存（${operatorClass} 类），呼号将写入 ADIF`
    : `台站资料已保存（${operatorClass} 类），台站呼号为空`);
}

// ========== 个人信息备份与恢复 ==========

async function handleExportPersonalInfo() {
  const button = document.getElementById('export-personal-info-btn');
  if (button?.disabled || !beginDataOperation('个人信息导出')) return;
  if (button) button.disabled = true;

  try {
    await ensureDatabase();
    const [repeaters, credentials] = await Promise.all([
      getAllRepeaters(),
      loadHamQthCredentials()
    ]);
    const hamqthUsername = credentials.username || localStorage.getItem(HAMQTH_USER_HINT_KEY) || '';
    const backup = {
      format: PERSONAL_INFO_FORMAT,
      schema_version: PERSONAL_INFO_SCHEMA_VERSION,
      app_version: APP_VERSION,
      exported_at: new Date().toISOString(),
      station_callsign: localStorage.getItem('hamlog_station_callsign') || '',
      operator_license: {
        region: 'CN',
        class: getStoredCnOperatorClass()
      },
      default_qth: readStoredJson('hamlog_default_qth', null),
      hamqth: {
        username: hamqthUsername,
        credentials_included: false
      },
      rig_presets: normalizeRigPresets(readStoredJson('hamlog_my_rigs', [])),
      repeaters: repeaters.map(repeater => ({
        name: repeater.name || '',
        rx_frequency: repeater.rx_frequency ?? null,
        tx_frequency: repeater.tx_frequency ?? null,
        tx_tone: repeater.tx_tone || '',
        rx_tone: repeater.rx_tone || '',
        location: repeater.location || '',
        notes: repeater.notes || ''
      }))
    };

    const plugin = getAdifFileManager();
    if (typeof plugin.exportPersonalInfo !== 'function') {
      throw new Error('个人信息导出接口不可用，请重新安装最新版 App');
    }
    const folder = await ensureExportFolder(plugin);
    if (!folder) return;

    let output = backup;
    const encryptBackup = document.getElementById('encrypt-personal-info')?.checked !== false;
    if (encryptBackup) {
      const passphrase = prompt('请设置个人信息备份密码（至少 8 个字符）。迁移设备时必须使用该密码：');
      if (passphrase === null) return;
      const confirmation = prompt('请再次输入备份密码：');
      if (confirmation === null) return;
      if (passphrase !== confirmation) throw new Error('两次输入的备份密码不一致');
      output = await encryptPersonalInfoBackup(backup, passphrase);
    }

    const filename = `ham-logbook-personal_${window.getExportDateString()}${encryptBackup ? '-encrypted' : ''}.json`;
    const result = await plugin.exportPersonalInfo({
      filename,
      content: JSON.stringify(output, null, 2)
    });
    updateExportFolderDisplay({ selected: true, name: result.folderName || folder.name, uri: folder.uri });
    window.showToast(`个人信息已保存到 ${result.folderName || folder.name || '所选文件夹'}/${result.filename || filename}`);
  } catch (error) {
    window.showToast('保存个人信息失败：' + (error.message || String(error)));
  } finally {
    if (button) button.disabled = false;
    endDataOperation();
  }
}

async function handleRestorePersonalInfo(event) {
  const input = event.currentTarget;
  const file = input?.files?.[0];
  if (!file) return;
  if (!beginDataOperation('个人信息恢复')) {
    input.value = '';
    return;
  }

  try {
    if (file.size > MAX_PERSONAL_INFO_FILE_SIZE) {
      throw new Error('备份文件过大，无法读取');
    }
    let parsed = JSON.parse(await readFileAsText(file));
    if (isEncryptedPersonalInfoBackup(parsed)) {
      const passphrase = prompt('请输入该个人信息备份的密码：');
      if (passphrase === null) return;
      parsed = await decryptPersonalInfoBackup(parsed, passphrase);
    }
    const backup = normalizePersonalInfoBackup(parsed);
    const confirmed = confirm(
      `恢复将覆盖当前个人设置和全部中继台（${backup.repeaters.length} 条），但不会修改 QSO 日志。是否继续？`
    );
    if (!confirmed) return;

    await ensureDatabase();
    const previousSettings = await snapshotPersonalInfoSettings();
    try {
      // 先写入可回滚的小型设置；中继台替换本身由 SQLite 事务保证原子性。
      await applyPersonalInfoBackup(backup);
      await replaceAllRepeaters(backup.repeaters);
    } catch (restoreError) {
      await restorePersonalInfoSettings(previousSettings);
      throw restoreError;
    }
    await loadSettings();
    const credentialMessage = backup.hamqth.password
      ? '，旧备份中的 HamQTH 密码已迁移到安全存储'
      : '；HamQTH 密码未包含在备份中，请重新填写';
    window.showToast(
      `个人信息恢复完成：已恢复 ${backup.repeaters.length} 条中继台和 ${backup.rig_presets.length} 个设备预设${credentialMessage}`,
      6000
    );
  } catch (error) {
    window.showToast('恢复个人信息失败：' + (error.message || String(error)));
  } finally {
    if (input) input.value = '';
    endDataOperation();
  }
}

export function normalizePersonalInfoBackup(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('不是有效的个人信息备份文件');
  }
  if (value.format !== PERSONAL_INFO_FORMAT) {
    throw new Error('文件类型不匹配，请选择本应用生成的个人信息备份');
  }
  const schemaVersion = Number(value.schema_version);
  if (![1, 2, PERSONAL_INFO_SCHEMA_VERSION].includes(schemaVersion)) {
    throw new Error(`不支持的备份版本：${value.schema_version ?? '未知'}`);
  }
  if (!Array.isArray(value.rig_presets) || !Array.isArray(value.repeaters)) {
    throw new Error('备份文件缺少设备预设或中继台列表');
  }

  let operatorClass = 'A';
  if (schemaVersion >= 2) {
    if (value.operator_license?.region !== 'CN' || !isValidCnOperatorClass(value.operator_license?.class)) {
      throw new Error('操作证类别数据无效');
    }
    operatorClass = String(value.operator_license.class).trim().toUpperCase();
  }

  return {
    station_callsign: String(value.station_callsign || '').trim().toUpperCase(),
    operator_class: operatorClass,
    default_qth: normalizeBackupQth(value.default_qth),
    hamqth: {
      username: String(value.hamqth?.username || '').trim(),
      password: String(value.hamqth?.password || '')
    },
    rig_presets: normalizeRigPresets(value.rig_presets),
    repeaters: value.repeaters.map((item, index) => normalizeBackupRepeater(item, index))
  };
}

function normalizeBackupQth(value) {
  if (value == null) return null;
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error('默认 QTH 数据无效');

  const lat = optionalNumberInRange(value.lat, -90, 90, '默认 QTH 纬度');
  const lon = optionalNumberInRange(value.lon, -180, 180, '默认 QTH 经度');
  const alt = optionalFiniteNumber(value.alt, '默认 QTH 海拔');
  const locator = normalizeLocator(value.locator || '');
  if (locator && !isValidLocator(locator)) throw new Error('默认 QTH 网格坐标无效');
  return { lat, lon, alt, locator };
}

function normalizeBackupRepeater(value, index) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`第 ${index + 1} 条中继台数据无效`);
  }
  const name = String(value.name || '').trim();
  if (!name) throw new Error(`第 ${index + 1} 条中继台缺少名称`);
  const txTone = normalizeTone(value.tx_tone);
  const rxTone = normalizeTone(value.rx_tone);
  if (!isValidTone(txTone) || !isValidTone(rxTone)) {
    throw new Error(`中继台“${name}”的亚音格式无效（应为 T88.5 或 D023N）`);
  }
  return {
    name,
    rx_frequency: optionalPositiveNumber(value.rx_frequency, `中继台“${name}”接收频率`),
    tx_frequency: optionalPositiveNumber(value.tx_frequency, `中继台“${name}”发射频率`),
    tx_tone: txTone,
    rx_tone: rxTone,
    location: String(value.location || '').trim(),
    notes: String(value.notes || '').trim()
  };
}

function normalizeRigPresets(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(item => String(item || '').trim()).filter(Boolean))].slice(0, 30);
}

function optionalFiniteNumber(value, label) {
  if (value == null || String(value).trim() === '') return null;
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`${label}无效`);
  return number;
}

function optionalNumberInRange(value, min, max, label) {
  const number = optionalFiniteNumber(value, label);
  if (number !== null && (number < min || number > max)) throw new Error(`${label}超出范围`);
  return number;
}

function optionalPositiveNumber(value, label) {
  const number = optionalFiniteNumber(value, label);
  if (number !== null && number <= 0) throw new Error(`${label}无效`);
  return number;
}

async function applyPersonalInfoBackup(backup) {
  setOrRemoveStoredValue('hamlog_station_callsign', backup.station_callsign);
  storeCnOperatorClass(backup.operator_class);
  if (backup.default_qth) {
    localStorage.setItem('hamlog_default_qth', JSON.stringify(backup.default_qth));
  } else {
    localStorage.removeItem('hamlog_default_qth');
  }
  await saveHamQthCredentials(backup.hamqth.username, backup.hamqth.password);
  localStorage.setItem('hamlog_my_rigs', JSON.stringify(backup.rig_presets));
  sessionStorage.removeItem('hamlog_hamqth_session');
}

function setOrRemoveStoredValue(key, value) {
  if (value) localStorage.setItem(key, value);
  else localStorage.removeItem(key);
}

async function snapshotPersonalInfoSettings() {
  const keys = [
    'hamlog_station_callsign', 'hamlog_default_qth', HAMQTH_USER_HINT_KEY,
    'hamlog_my_rigs', CN_OPERATOR_CLASS_KEY
  ];
  return {
    local: keys.map(key => ({ key, value: localStorage.getItem(key) })),
    credentials: await loadHamQthCredentials()
  };
}

async function restorePersonalInfoSettings(snapshot) {
  await saveHamQthCredentials(snapshot?.credentials?.username || '', snapshot?.credentials?.password || '');
  for (const item of snapshot?.local || []) {
    if (item.value == null) localStorage.removeItem(item.key);
    else localStorage.setItem(item.key, item.value);
  }
}

function readStoredJson(key, fallbackValue) {
  const raw = localStorage.getItem(key);
  if (!raw) return fallbackValue;
  try {
    return JSON.parse(raw);
  } catch (error) {
    return fallbackValue;
  }
}

function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = event => resolve(String(event.target?.result || ''));
    reader.onerror = () => reject(new Error('文件读取失败'));
    reader.readAsText(file);
  });
}

// ========== ADIF 导出文件夹 ==========

function getAdifFileManager() {
  const plugin = window.Capacitor?.Plugins?.AdifFileManager;
  if (!plugin || typeof plugin.getExportFolder !== 'function' || typeof plugin.exportAdif !== 'function') {
    throw new Error('目录选择插件不可用，请重新同步并安装最新版 App');
  }
  return plugin;
}

function updateExportFolderDisplay(folder, fallbackMessage = '尚未选择；首次导出时会打开系统文件夹选择器') {
  const display = document.getElementById('export-folder-name');
  if (!display) return;
  const selected = !!folder?.selected;
  display.textContent = selected ? `已选择：${folder.name || '导出文件夹'}` : fallbackMessage;
  display.classList.toggle('is-selected', selected);
  display.title = selected && folder.uri ? folder.uri : '';
}

async function refreshExportFolderStatus() {
  try {
    if (window._waitForCapacitor) await window._waitForCapacitor(3000);
    const folder = await getAdifFileManager().getExportFolder();
    updateExportFolderDisplay(folder);
  } catch (error) {
    updateExportFolderDisplay(null, error.message || '无法读取导出文件夹设置');
  }
}

async function handleChooseExportFolder() {
  const button = document.getElementById('choose-export-folder-btn');
  if (button?.disabled || !beginDataOperation('文件夹选择')) return;
  if (button) button.disabled = true;

  try {
    const folder = await getAdifFileManager().chooseExportFolder();
    if (!folder?.selected) return;
    updateExportFolderDisplay(folder);
    window.showToast(`导出文件夹已设为：${folder.name || '所选文件夹'}`);
  } catch (error) {
    window.showToast('选择文件夹失败：' + (error.message || String(error)));
  } finally {
    if (button) button.disabled = false;
    endDataOperation();
  }
}

async function ensureExportFolder(plugin) {
  let folder = await plugin.getExportFolder();
  if (folder?.selected) return folder;

  folder = await plugin.chooseExportFolder();
  if (!folder?.selected) return null;
  updateExportFolderDisplay(folder);
  return folder;
}

// ========== 导出 ADIF ==========

async function handleExport() {
  const exportBtn = document.getElementById('export-adif-btn');
  if (exportBtn.disabled || !beginDataOperation('ADIF 导出')) return;
  const originalLabel = exportBtn.textContent;
  exportBtn.disabled = true;
  let exportSessionId = null;

  try {
    await ensureDatabase();
    const firstPage = await getQsoExportPage(0, ADIF_EXPORT_BATCH_SIZE);
    if (firstPage.qsos.length === 0) {
      window.showToast('没有可导出的 QSO 记录');
      return;
    }

    const filename = `ham-logbook_${window.getExportDateString()}.adi`;
    const adifOptions = {
      includeStationCoordinates: document.getElementById('include-adif-coordinates')?.checked === true
    };
    const plugin = getAdifFileManager();
    if (!plugin.beginAdifExport || !plugin.appendAdifExport || !plugin.finishAdifExport || !plugin.abortAdifExport) {
      throw new Error('分块导出接口不可用，请重新安装最新版 App');
    }
    const folder = await ensureExportFolder(plugin);
    if (!folder) return;

    const started = await plugin.beginAdifExport({ filename, content: generateADIFHeader() });
    exportSessionId = started.sessionId;
    const count = await writeAdifPages(firstPage, async chunk => {
      await plugin.appendAdifExport({ sessionId: exportSessionId, content: chunk });
    }, written => {
      exportBtn.textContent = `正在导出 ${written} 条…`;
    }, adifOptions);
    const result = await plugin.finishAdifExport({ sessionId: exportSessionId });
    exportSessionId = null;
    updateExportFolderDisplay({ selected: true, name: result.folderName || folder.name, uri: folder.uri });
    localStorage.setItem('hamlog_last_adif_export_at', new Date().toISOString());
    window.showToast(`已导出 ${count} 条日志到 ${result.folderName || folder.name || '所选文件夹'}/${result.filename || filename}`);
  } catch (error) {
    if (exportSessionId) {
      try { await getAdifFileManager().abortAdifExport({ sessionId: exportSessionId }); }
      catch (abortError) { /* 保留原始错误 */ }
    }
    window.showToast('导出失败：' + error.message);
  } finally {
    exportBtn.disabled = false;
    exportBtn.textContent = originalLabel;
    endDataOperation();
  }
}

async function writeAdifPages(firstPage, writeChunk, onProgress, adifOptions = {}) {
  let page = firstPage;
  let written = 0;
  while (page.qsos.length > 0) {
    const records = generateADIFRecords(page.qsos, adifOptions);
    if (records) await writeChunk(`\r\n${records}`);
    written += page.qsos.length;
    if (onProgress) onProgress(written);
    if (!page.hasMore) break;
    page = await getQsoExportPage(page.nextId, ADIF_EXPORT_BATCH_SIZE);
  }
  return written;
}

// ========== 导入 ADIF ==========

async function handleImport(event) {
  const input = event.currentTarget;
  const file = input.files?.[0];
  if (!file) return;
  if (!beginDataOperation('ADIF 导入')) {
    input.value = '';
    return;
  }
  input.disabled = true;

  let imported = 0;
  let skipped = 0;
  let overwritten = 0;
  let invalid = 0;
  let parsedCount = 0;
  let batch = [];
  let importTransactionStarted = false;

  try {
    if (file.size > MAX_ADIF_FILE_SIZE) {
      throw new Error('ADIF 文件超过 256 MB 安全上限，请拆分后导入');
    }
    const storagePlugin = window.Capacitor?.Plugins?.SecureData;
    if (storagePlugin?.getStorageInfo) {
      const storage = await storagePlugin.getStorageInfo();
      const requiredBytes = Math.max(64 * 1024 * 1024, file.size * 4);
      if (Number(storage?.availableBytes) < requiredBytes) {
        throw new Error('设备剩余空间不足，无法安全地以事务方式导入此文件');
      }
    }
    await ensureDatabase();
    const overwriteDuplicates = confirm('导入时如果发现本机已有相同呼号、日期、时间和频段的记录：\n\n确定＝用 ADIF 中已有的字段覆盖\n取消＝保留本机记录并跳过重复项');
    await beginQsoImport();
    importTransactionStarted = true;

    const flushBatch = async () => {
      if (!batch.length) return;
      const result = await importQsoBatch(batch, overwriteDuplicates, true);
      imported += result.imported;
      overwritten += result.overwritten;
      skipped += result.skipped;
      batch = [];
      window.showToast(`正在导入：已处理 ${parsedCount} 条`, 1200);
      // 给 WebView 一次渲染机会，避免大型文件导入期间界面长时间无响应。
      await new Promise(resolve => setTimeout(resolve, 0));
    };

    for await (const rawQso of parseADIFFile(file)) {
      parsedCount++;
      if (parsedCount > MAX_ADIF_RECORDS) {
        throw new Error(`ADIF 记录超过 ${MAX_ADIF_RECORDS} 条安全上限，请拆分后导入`);
      }
      const qso = normalizeImportedQso(rawQso);
      if (!qso) {
        invalid++;
        continue;
      }
      batch.push(qso);
      if (batch.length >= ADIF_IMPORT_BATCH_SIZE) await flushBatch();
    }
    await flushBatch();
    await commitQsoImport();
    importTransactionStarted = false;
    if (isAutomaticBackupEnabled()) {
      void maybeCreateAutomaticBackup({ force: true }).catch(error => {
        window.showToast('导入已完成，但自动备份失败：' + (error.message || String(error)), 5000);
      });
    }

    if (parsedCount === 0) {
      window.showToast('未在文件中找到带 CALL 字段的 QSO 记录');
      return;
    }
    window.showToast(`导入完成：新增 ${imported}，覆盖 ${overwritten}，跳过 ${skipped}，无效 ${invalid}`, 5000);
  } catch (error) {
    if (importTransactionStarted) {
      try {
        await rollbackQsoImport();
        imported = 0;
        overwritten = 0;
      } catch (rollbackError) {
        window.showToast('导入失败且事务回滚异常，请立即导出日志核对数据：' + (rollbackError.message || String(rollbackError)), 7000);
        return;
      }
    }
    window.showToast('导入失败，未保留本次文件的部分数据：' + (error.message || String(error)), 5000);
  } finally {
    input.disabled = false;
    // 允许用户修正文件后再次选择同一个文件。
    input.value = '';
    endDataOperation();
  }
}

// ========== 分享 ADIF ==========

async function handleShare() {
  const shareBtn = document.getElementById('share-adif-btn');
  if (shareBtn.disabled || !beginDataOperation('ADIF 分享')) return;
  const originalLabel = shareBtn.textContent;
  shareBtn.disabled = true;
  let cleanupFilesystem = null;
  let cleanupDirectory = null;
  let shareCacheCreated = false;

  try {
    await ensureDatabase();
    const firstPage = await getQsoExportPage(0, ADIF_EXPORT_BATCH_SIZE);
    if (firstPage.qsos.length === 0) {
      window.showToast('没有可分享的 QSO 记录');
      return;
    }

    // 缓存目录使用固定名称，避免长期分享产生大量临时文件。
    const filename = 'ham-logbook-share.adi';
    const adifOptions = {
      includeStationCoordinates: document.getElementById('include-adif-coordinates')?.checked === true
    };

    const Filesystem = window.FilesystemPlugin;
    const Directory = window.FilesystemDirectory;
    const Encoding = window.FilesystemEncoding;
    const Share = window.SharePlugin;
    if (!Filesystem?.writeFile || !Filesystem?.appendFile || !Filesystem?.getUri || !Share?.share) {
      throw new Error('文件或分享插件不可用，请重新安装最新版 App');
    }
    cleanupFilesystem = Filesystem;
    cleanupDirectory = Directory;

    let fileUri;
    try {
      // Share 插件的 FileProvider 已允许缓存目录；这里不再使用不可分享的 Directory.Data。
      const writeResult = await Filesystem.writeFile({
        path: `ham-logbook/${filename}`,
        data: generateADIFHeader(),
        directory: Directory.Cache,
        encoding: Encoding.UTF8,
        recursive: true
      });
      shareCacheCreated = true;
      await writeAdifPages(firstPage, async chunk => {
        await Filesystem.appendFile({
          path: `ham-logbook/${filename}`,
          data: chunk,
          directory: Directory.Cache,
          encoding: Encoding.UTF8
        });
      }, written => {
        shareBtn.textContent = `正在准备 ${written} 条…`;
      }, adifOptions);
      fileUri = writeResult?.uri;
      if (!fileUri) {
        const fileUriResult = await Filesystem.getUri({
          path: `ham-logbook/${filename}`,
          directory: Directory.Cache
        });
        fileUri = fileUriResult.uri;
      }
    } catch (fileError) {
      console.warn('准备分享文件失败，尝试小日志文本分享:', fileError);
      await shareAdifAsText(Share, await buildLimitedAdifText(firstPage, adifOptions));
      return;
    }

    try {
      await Share.share({
        files: [fileUri],
        title: '分享 ADIF 日志',
        dialogTitle: '分享 ADIF 日志'
      });
    } catch (shareError) {
      // 用户关闭系统分享面板属于正常取消，不再次弹出文本分享。
      if (/cancel/i.test(shareError?.message || String(shareError))) return;
      console.warn('文件分享失败，尝试小日志文本分享:', shareError);
      await shareAdifAsText(Share, await buildLimitedAdifText(firstPage, adifOptions));
    }
  } catch (error) {
    window.showToast('分享失败：' + error.message);
  } finally {
    if (shareCacheCreated && cleanupFilesystem?.deleteFile) {
      try {
        await cleanupFilesystem.deleteFile({
          path: 'ham-logbook/ham-logbook-share.adi',
          directory: cleanupDirectory.Cache
        });
      } catch (cleanupError) { /* 系统稍后仍会清理缓存，不覆盖分享结果。 */ }
    }
    shareBtn.disabled = false;
    shareBtn.textContent = originalLabel;
    endDataOperation();
  }
}

async function buildLimitedAdifText(firstPage, adifOptions = {}) {
  const chunks = [generateADIFHeader()];
  let page = firstPage;
  let count = 0;
  while (page.qsos.length > 0) {
    count += page.qsos.length;
    if (count > TEXT_SHARE_RECORD_LIMIT || (count === TEXT_SHARE_RECORD_LIMIT && page.hasMore)) {
      throw new Error(`日志超过 ${TEXT_SHARE_RECORD_LIMIT} 条，无法使用文本降级分享，请先导出 ADIF 文件`);
    }
    const records = generateADIFRecords(page.qsos, adifOptions);
    if (records) chunks.push(records);
    if (!page.hasMore) break;
    page = await getQsoExportPage(page.nextId, ADIF_EXPORT_BATCH_SIZE);
  }
  return chunks.join('\r\n');
}

async function shareAdifAsText(sharePlugin, adifContent) {
  if (!sharePlugin?.share) throw new Error('分享插件不可用');
  await sharePlugin.share({
    text: adifContent,
    title: '分享 ADIF 日志',
    dialogTitle: '分享 ADIF 日志'
  });
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
    if (!isValidDbTime(qso.time_off)) qso.time_off = '';
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
  if (qso.my_lat != null && (!Number.isFinite(Number(qso.my_lat)) || Number(qso.my_lat) < -90 || Number(qso.my_lat) > 90)) delete qso.my_lat;
  if (qso.my_lon != null && (!Number.isFinite(Number(qso.my_lon)) || Number(qso.my_lon) < -180 || Number(qso.my_lon) > 180)) delete qso.my_lon;
  if (qso.frequency != null && (!Number.isFinite(Number(qso.frequency)) || Number(qso.frequency) <= 0)) delete qso.frequency;
  if (qso.qsl_considered !== undefined) qso.qsl_considered = Number(qso.qsl_considered) === 1 ? 1 : 0;

  const textLimits = {
    operator_name: 128,
    qth: 512,
    rst_sent: 8,
    rst_rcvd: 8,
    my_power: 32,
    their_power: 32,
    my_antenna: 256,
    my_rig: 256,
    their_antenna: 256,
    their_rig: 256,
    notes: 16384,
    station_callsign: 32
  };
  for (const [field, limit] of Object.entries(textLimits)) {
    if (qso[field] != null) qso[field] = String(qso[field]).slice(0, limit);
  }

  if (!qso.callsign || qso.callsign.length > 32 || !isValidDbDate(qso.qso_date) || !isValidDbTime(qso.time_on) || !SUPPORTED_BANDS.includes(qso.band) || !qso.mode || qso.mode.length > 32) {
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
