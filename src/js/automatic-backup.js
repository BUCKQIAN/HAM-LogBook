/* ============================================================
   automatic-backup.js - 用户授权目录中的滚动 ADIF 灾难恢复副本
   最多每天生成一份，并由原生层只保留最近 7 份。
   ============================================================ */

import { getQsoExportPage } from './db.js';
import { generateADIFHeader, generateADIFRecords } from './adif.js';

export const AUTO_BACKUP_ENABLED_KEY = 'hamlog_auto_adif_backup';
const LAST_BACKUP_DATE_KEY = 'hamlog_auto_adif_backup_date';
const BACKUP_BATCH_SIZE = 250;
let activeBackup = null;

function localDateKey() {
  const now = new Date();
  return [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0')
  ].join('');
}

export function isAutomaticBackupEnabled() {
  return localStorage.getItem(AUTO_BACKUP_ENABLED_KEY) === '1';
}

export function setAutomaticBackupEnabled(enabled) {
  if (enabled) localStorage.setItem(AUTO_BACKUP_ENABLED_KEY, '1');
  else localStorage.removeItem(AUTO_BACKUP_ENABLED_KEY);
}

export async function maybeCreateAutomaticBackup({ force = false } = {}) {
  if (!isAutomaticBackupEnabled()) return { created: false, reason: 'disabled' };
  if (activeBackup) return activeBackup;
  const today = localDateKey();
  if (!force && localStorage.getItem(LAST_BACKUP_DATE_KEY) === today) {
    return { created: false, reason: 'already-created-today' };
  }

  activeBackup = createBackup(today).finally(() => {
    activeBackup = null;
  });
  return activeBackup;
}

async function createBackup(dateKey) {
  const plugin = window.Capacitor?.Plugins?.AdifFileManager;
  if (!plugin?.getExportFolder || !plugin?.beginAdifExport || !plugin?.appendAdifExport || !plugin?.finishAdifExport) {
    throw new Error('自动备份接口不可用');
  }
  const folder = await plugin.getExportFolder();
  if (!folder?.selected) throw new Error('自动备份文件夹授权已失效，请在设置中重新选择');

  const firstPage = await getQsoExportPage(0, BACKUP_BATCH_SIZE);
  if (!firstPage.qsos.length) return { created: false, reason: 'empty' };

  let sessionId = null;
  try {
    const started = await plugin.beginAdifExport({
      filename: `ham-logbook-auto_${dateKey}.adi`,
      content: generateADIFHeader()
    });
    sessionId = started.sessionId;
    let page = firstPage;
    let count = 0;
    while (page.qsos.length) {
      const records = generateADIFRecords(page.qsos);
      if (records) await plugin.appendAdifExport({ sessionId, content: `\r\n${records}` });
      count += page.qsos.length;
      if (!page.hasMore) break;
      page = await getQsoExportPage(page.nextId, BACKUP_BATCH_SIZE);
    }
    const result = await plugin.finishAdifExport({ sessionId });
    sessionId = null;
    localStorage.setItem(LAST_BACKUP_DATE_KEY, dateKey);
    if (plugin.pruneAutomaticBackups) {
      try { await plugin.pruneAutomaticBackups({ keep: 7 }); }
      catch (error) { /* 备份已经成功，旧文件清理失败不应抹掉成功状态。 */ }
    }
    return { created: true, count, filename: result.filename, folderName: result.folderName };
  } catch (error) {
    if (sessionId && plugin.abortAdifExport) {
      try { await plugin.abortAdifExport({ sessionId }); }
      catch (abortError) { /* 保留原始错误。 */ }
    }
    throw error;
  }
}
