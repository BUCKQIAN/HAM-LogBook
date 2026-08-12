/* ============================================================
   db.js - SQLite 数据库单例封装
   直接使用 window.CapacitorSQLite（不依赖 SQLiteConnection 封装）
   ============================================================ */

import { normalizeTone } from './radio.js';

var CAPSQL = null;
var DBNAME = 'hamlogbook';
var DB_RECOVERY_PROMISE = null;

function generateDatabaseSecret() {
  var bytes = new Uint8Array(32);
  window.crypto.getRandomValues(bytes);
  var binary = '';
  for (var i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

async function ensureDatabaseEncryptionSecret(sqlite) {
  if (typeof sqlite.isSecretStored !== 'function' || typeof sqlite.setEncryptionSecret !== 'function') {
    throw new Error('当前数据库插件不支持安全加密');
  }
  var stored = await sqlite.isSecretStored();
  if (stored && stored.result) return;
  try {
    await sqlite.setEncryptionSecret({ passphrase: generateDatabaseSecret() });
  } catch (error) {
    // 加密数据库仍在但 Keystore 数据异常时，不持久化一个错误的新密钥。
    try { await sqlite.clearEncryptionSecret(); }
    catch (cleanupError) { /* 保留原始错误。 */ }
    throw error;
  }
}

async function registerDatabaseConnection(sqlite, mode) {
  await sqlite.createConnection({
    database: DBNAME,
    encrypted: true,
    mode: mode,
    version: 1,
    readonly: false
  });
}

async function replaceConnectionForPlaintextMigration(sqlite) {
  try { await sqlite.closeConnection({ database: DBNAME, readonly: false }); }
  catch (error) { /* 未打开的连接也必须从原生连接池移除，忽略兼容性差异。 */ }
  await registerDatabaseConnection(sqlite, 'encryption');
  await sqlite.open({ database: DBNAME, readonly: false });
  // encryption 连接只允许执行一次；立即改回 secret，避免生命周期重开时重复加密。
  await sqlite.closeConnection({ database: DBNAME, readonly: false });
  await registerDatabaseConnection(sqlite, 'secret');
  await sqlite.open({ database: DBNAME, readonly: false });
}

function getCap() {
  if (!CAPSQL || typeof CAPSQL.createConnection !== 'function') {
    CAPSQL = (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.CapacitorSQLite) || null;
  }
  if (!CAPSQL || typeof CAPSQL.createConnection !== 'function') {
    throw new Error('插件不可用');
  }
  return CAPSQL;
}

// ========== 建表 SQL ==========
var CREATE_TABLE_QSO = 'CREATE TABLE IF NOT EXISTS qsos (' +
  'id INTEGER PRIMARY KEY AUTOINCREMENT, callsign TEXT NOT NULL, operator_name TEXT, qth TEXT, locator TEXT, ' +
  'rst_sent TEXT, rst_rcvd TEXT, qsl_considered INTEGER NOT NULL DEFAULT 0, mode TEXT, band TEXT, frequency REAL, qso_date TEXT NOT NULL, ' +
  'time_on TEXT, time_off TEXT, my_lat REAL, my_lon REAL, my_alt REAL, my_locator TEXT, ' +
  'my_power TEXT, my_antenna TEXT, my_rig TEXT, their_power TEXT, their_rig TEXT, their_antenna TEXT, ' +
  'notes TEXT, station_callsign TEXT, created_at INTEGER, updated_at INTEGER)';

var CREATE_TABLE_REPEATERS = 'CREATE TABLE IF NOT EXISTS repeaters (' +
  'id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, rx_frequency REAL, tx_frequency REAL, ' +
  'tx_tone TEXT, rx_tone TEXT, location TEXT, notes TEXT, created_at INTEGER)';

var CREATE_TABLE_META = 'CREATE TABLE IF NOT EXISTS app_meta (' +
  'key TEXT PRIMARY KEY, value TEXT NOT NULL)';

var CREATE_INDEXES = [
  'CREATE INDEX IF NOT EXISTS idx_qso_callsign ON qsos(callsign)',
  'CREATE INDEX IF NOT EXISTS idx_qso_date ON qsos(qso_date)',
  'CREATE INDEX IF NOT EXISTS idx_qso_band ON qsos(band)',
  'CREATE INDEX IF NOT EXISTS idx_qso_mode ON qsos(mode)',
  "CREATE INDEX IF NOT EXISTS idx_qso_history_page_v2 ON qsos(qso_date DESC, COALESCE(time_on, '') DESC, id DESC)",
  'CREATE INDEX IF NOT EXISTS idx_qso_counterpart_history ON qsos(callsign, qso_date DESC, time_on DESC, id DESC)',
  'CREATE INDEX IF NOT EXISTS idx_qso_duplicate ON qsos(callsign, qso_date, time_on, band)'
];

var QSO_INSERT_SQL = 'INSERT INTO qsos (callsign, operator_name, qth, locator, rst_sent, rst_rcvd, qsl_considered, mode, band, frequency, qso_date, time_on, time_off, my_lat, my_lon, my_alt, my_locator, my_power, my_antenna, my_rig, their_power, their_rig, their_antenna, notes, station_callsign, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)';
var QSO_IMPORT_FIELDS = [
  'callsign', 'operator_name', 'qth', 'locator', 'rst_sent', 'rst_rcvd',
  'qsl_considered', 'mode', 'band', 'frequency', 'qso_date', 'time_on', 'time_off',
  'my_lat', 'my_lon', 'my_alt', 'my_locator', 'my_power', 'my_antenna', 'my_rig',
  'their_power', 'their_rig', 'their_antenna', 'notes', 'station_callsign'
];

async function getMetaValue(sqlite, key) {
  var result = await sqlite.query({
    database: DBNAME,
    statement: 'SELECT value FROM app_meta WHERE key = ?',
    values: [key]
  });
  return result.values && result.values.length ? result.values[0].value : null;
}

async function setMetaValue(sqlite, key, value) {
  await sqlite.run({
    database: DBNAME,
    statement: 'INSERT OR REPLACE INTO app_meta (key, value) VALUES (?, ?)',
    values: [key, String(value)]
  });
}

async function getTableColumns(sqlite, table) {
  var result = await sqlite.query({
    database: DBNAME,
    statement: 'PRAGMA table_info(' + table + ')',
    values: []
  });
  return result.values || [];
}

async function addColumnIfMissing(sqlite, table, column, definition) {
  var columns = await getTableColumns(sqlite, table);
  var exists = columns.some(function(item) { return item.name === column; });
  if (!exists) {
    await sqlite.execute({
      database: DBNAME,
      statements: 'ALTER TABLE ' + table + ' ADD COLUMN ' + column + ' ' + definition
    });
  }
}

async function migrateSchema(sqlite) {
  // 兼容已安装的早期版本：CREATE TABLE IF NOT EXISTS 不会自动补列。
  var qsoColumns = await getTableColumns(sqlite, 'qsos');
  var hasLegacyQslExchange = qsoColumns.some(function(item) { return item.name === 'qsl_exchanged'; });
  await addColumnIfMissing(sqlite, 'qsos', 'my_rig', 'TEXT');
  await addColumnIfMissing(sqlite, 'qsos', 'my_locator', 'TEXT');
  await addColumnIfMissing(sqlite, 'qsos', 'station_callsign', 'TEXT');
  await addColumnIfMissing(sqlite, 'qsos', 'qsl_considered', 'INTEGER NOT NULL DEFAULT 0');
  // 1.1.0 曾将“考虑交换”误写为 qsl_exchanged；迁移必须只执行一次。
  if (await getMetaValue(sqlite, 'migration_qsl_considered_v1') !== 'done') {
    if (hasLegacyQslExchange) {
      await sqlite.execute({
        database: DBNAME,
        statements: 'UPDATE qsos SET qsl_considered = 1 WHERE qsl_considered = 0 AND qsl_exchanged = 1'
      });
    }
    await setMetaValue(sqlite, 'migration_qsl_considered_v1', 'done');
  }

  // 早期版本的中继台表使用 frequency / shift / tone；保留旧数据并补齐新字段。
  var oldColumns = await getTableColumns(sqlite, 'repeaters');
  var hasFrequency = oldColumns.some(function(item) { return item.name === 'frequency'; });
  var hasTone = oldColumns.some(function(item) { return item.name === 'tone'; });
  await addColumnIfMissing(sqlite, 'repeaters', 'rx_frequency', 'REAL');
  await addColumnIfMissing(sqlite, 'repeaters', 'tx_frequency', 'REAL');
  await addColumnIfMissing(sqlite, 'repeaters', 'tx_tone', 'TEXT');
  await addColumnIfMissing(sqlite, 'repeaters', 'rx_tone', 'TEXT');
  await addColumnIfMissing(sqlite, 'repeaters', 'location', 'TEXT');
  await addColumnIfMissing(sqlite, 'repeaters', 'notes', 'TEXT');
  // 仅对尚未填过的新字段迁移旧记录，避免覆盖用户之后的修改。
  var migrationSql = [];
  if (hasFrequency) migrationSql.push('UPDATE repeaters SET rx_frequency = frequency WHERE rx_frequency IS NULL AND frequency IS NOT NULL');
  if (hasTone) migrationSql.push('UPDATE repeaters SET tx_tone = tone WHERE tx_tone IS NULL AND tone IS NOT NULL');
  if (migrationSql.length) {
    await sqlite.execute({ database: DBNAME, statements: migrationSql.join(';') + ';' });
  }
  if (await getMetaValue(sqlite, 'migration_tone_format_v1') !== 'done') {
    await normalizeStoredRepeaterTones(sqlite);
    await setMetaValue(sqlite, 'migration_tone_format_v1', 'done');
  }
}

async function normalizeStoredRepeaterTones(sqlite) {
  var result = await sqlite.query({
    database: DBNAME,
    statement: 'SELECT id, tx_tone, rx_tone FROM repeaters',
    values: []
  });
  for (var i = 0; i < (result.values || []).length; i++) {
    var item = result.values[i];
    var txTone = normalizeTone(item.tx_tone);
    var rxTone = normalizeTone(item.rx_tone);
    if (txTone === (item.tx_tone || '') && rxTone === (item.rx_tone || '')) continue;
    await sqlite.run({
      database: DBNAME,
      statement: 'UPDATE repeaters SET tx_tone = ?, rx_tone = ? WHERE id = ?',
      values: [txTone, rxTone, item.id]
    });
  }
}

// ========== 初始化 ==========
export async function initDatabase() {
  if (window._dbReady) return true;
  if (!window._dbInitPromise) window._dbInitPromise = initializeDatabase();
  try {
    return await window._dbInitPromise;
  } catch (error) {
    // 失败后允许用户操作触发重试，不把一次瞬时故障永久缓存。
    window._dbInitPromise = null;
    throw error;
  }
}

async function initializeDatabase() {
  if (window._dbReady) return true;

  // 等待 Capacitor 桥接就绪
  if (window._waitForCapacitor) {
    await window._waitForCapacitor(5000);
  }

  var s;
  try { s = getCap(); }
  catch (e) { throw new Error('插件不可用'); }

  // 插件使用 Android Keystore 加密的 SharedPreferences 保存随机 SQLCipher 密钥。
  // 首次升级会在打开旧数据库前完成原地加密；后续只以 secret 模式打开。
  try { await ensureDatabaseEncryptionSecret(s); }
  catch (e) { throw new Error('数据库安全初始化失败: ' + (e.message || String(e))); }

  /*
   * 原生插件的连接池在 Android Activity 生命周期内持续存在，但每次
   * index/history/repeater 页面加载时 JS 上下文都会重新建立。因此不能
   * 无条件 createConnection，否则第二个页面一定得到 “already exists”。
   */
  var connectionExists = false;
  var isOpen = false;
  try {
    var openState = await s.isDBOpen({ database: DBNAME, readonly: false });
    connectionExists = true;
    isOpen = !!openState.result;
  } catch (probeError) {
    // “No available connection” 是首次启动的正常状态，随后才创建连接。
  }

  if (!connectionExists) {
    try {
      await registerDatabaseConnection(s, 'secret');
    } catch (createError) {
      // 探测和创建之间如有另一页面注册连接，直接复用。
      var createMsg = createError.message || String(createError) || '';
      if (!/already exists|connection .* exists/i.test(createMsg)) {
        throw new Error('建连接失败: ' + createMsg);
      }
      connectionExists = true;
    }
  }

  if (!isOpen) {
    try {
      await s.open({ database: DBNAME, readonly: false });
    } catch (openError) {
      var openMsg = openError.message || String(openError) || '';
      // 1.0.x 的数据库是明文。secret 模式无法打开时，以插件的 encryption
      // 模式原地迁移；SQLCipher 在替换原文件前先生成并完成新数据库。
      if (!connectionExists && /encrypt|not a database|file is not a database|malformed/i.test(openMsg)) {
        try {
          await replaceConnectionForPlaintextMigration(s);
          isOpen = true;
        } catch (migrationError) {
          throw new Error('数据库加密迁移失败，原日志未删除: ' + (migrationError.message || String(migrationError)));
        }
      }
      if (isOpen) {
        // 已由迁移流程打开。
      } else {
      // 某些插件版本对已打开连接返回错误；再确认一次真实状态。
      try {
        var retryState = await s.isDBOpen({ database: DBNAME, readonly: false });
        if (!retryState.result) throw openError;
      } catch (verifyError) {
        throw new Error('打开失败: ' + openMsg);
      }
      }
    }
  }

  // 建表
  try { await s.execute({ database: DBNAME, statements: CREATE_TABLE_QSO }); }
  catch (err) { throw new Error('建qsos表: ' + (err.message || String(err))); }

  try { await s.execute({ database: DBNAME, statements: CREATE_TABLE_REPEATERS }); }
  catch (err) { throw new Error('建repeaters表: ' + (err.message || String(err))); }

  try { await s.execute({ database: DBNAME, statements: CREATE_TABLE_META }); }
  catch (err) { throw new Error('建app_meta表: ' + (err.message || String(err))); }

  try { await migrateSchema(s); }
  catch (err) { throw new Error('升级数据库: ' + (err.message || String(err))); }

  // 索引
  for (var i = 0; i < CREATE_INDEXES.length; i++) {
    try { await s.execute({ database: DBNAME, statements: CREATE_INDEXES[i] }); }
    catch (err) { /* 索引失败不阻断 */ }
  }

  // 验证
  try { await s.query({ database: DBNAME, statement: 'SELECT 1 AS ok', values: [] }); }
  catch (err) { throw new Error('查询验证: ' + (err.message || String(err))); }

  // 兼容页面控制器：旧代码检查 dbInstance，新实现直调原生插件。
  // 这里保留一个轻量状态对象，不保存另一份原生连接。
  window.dbInstance = { database: DBNAME, native: true };
  window._dbReady = true;
  return true;
}

function db() {
  // 每次调用时重新获取插件引用（防止引用过期）
  var s = getCap();
  if (!s) throw new Error('插件不可用');
  return s;
}

function isRecoverableDatabaseReadError(error) {
  var message = error && error.message ? error.message : String(error || '');
  return /no available connection|database .* not opened|database .* closed|connection .* closed/i.test(message);
}

/**
 * 页面驻留或从后台恢复后，原生 SQLite 连接可能已被系统关闭，而当前 WebView
 * 仍保留 _dbReady。只读查询可安全地重建连接并重试一次。
 */
async function queryDatabase(statement, values) {
  var options = { database: DBNAME, statement: statement, values: values || [] };
  try {
    return await db().query(options);
  } catch (error) {
    if (!isRecoverableDatabaseReadError(error)) throw error;
    if (!DB_RECOVERY_PROMISE) {
      DB_RECOVERY_PROMISE = (async function() {
        window._dbReady = false;
        window._dbInitPromise = null;
        window.dbInstance = null;
        await initDatabase();
      })().finally(function() {
        DB_RECOVERY_PROMISE = null;
      });
    }
    await DB_RECOVERY_PROMISE;
    return db().query(options);
  }
}

// ========== QSO CRUD ==========
function normalizeHistoryCursor(cursor) {
  if (!cursor || typeof cursor !== 'object') return null;
  var id = Number(cursor.id);
  var date = String(cursor.qso_date == null ? '' : cursor.qso_date);
  if (!date || !Number.isFinite(id) || id <= 0) return null;
  return {
    qso_date: date,
    time_on: String(cursor.time_on == null ? '' : cursor.time_on),
    id: id
  };
}

/** 构造可独立测试的历史分页查询；forceOffset 仅用于游标查询异常时降级。 */
export function buildQsoPageQuery(filters, limit, cursor, offset, forceOffset = false) {
  var f = filters || {};
  var pageSize = Math.max(1, Math.min(Number(limit) || 100, 200));
  var conds = [], params = [];
  if (f.callsign) {
    var callsignPrefix = String(f.callsign).trim().toUpperCase();
    // 呼号采用前缀搜索，范围条件可以使用 idx_qso_callsign；%关键词% 会让大数据库全表扫描。
    conds.push('callsign >= ? AND callsign < ?');
    params.push(callsignPrefix, callsignPrefix + '\uffff');
  }
  if (f.dateFrom) { conds.push('qso_date >= ?'); params.push(f.dateFrom); }
  if (f.dateTo) { conds.push('qso_date <= ?'); params.push(f.dateTo); }
  if (f.band) { conds.push('band = ?'); params.push(f.band); }
  if (f.mode) { conds.push('mode = ?'); params.push(f.mode); }

  var normalizedCursor = forceOffset ? null : normalizeHistoryCursor(cursor);
  if (normalizedCursor) {
    conds.push("(qso_date < ? OR (qso_date = ? AND COALESCE(time_on, '') < ?) OR (qso_date = ? AND COALESCE(time_on, '') = ? AND id < ?))");
    params.push(
      normalizedCursor.qso_date,
      normalizedCursor.qso_date,
      normalizedCursor.time_on,
      normalizedCursor.qso_date,
      normalizedCursor.time_on,
      normalizedCursor.id
    );
  }

  var where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';
  var statement = "SELECT id, callsign, mode, band, frequency, operator_name, qso_date, time_on, rst_sent, rst_rcvd, qsl_considered FROM qsos " +
    where + " ORDER BY qso_date DESC, COALESCE(time_on, '') DESC, id DESC LIMIT ?";
  params.push(pageSize + 1);

  var usesOffset = forceOffset;
  if (usesOffset) {
    statement += ' OFFSET ?';
    params.push(Math.max(0, Number(offset) || 0));
  }
  return {
    statement: statement,
    values: params,
    pageSize: pageSize,
    usesCursor: !!normalizedCursor,
    usesOffset: usesOffset
  };
}

/** 分页读取历史列表所需的轻量字段，避免长期使用后一次性载入全部日志。 */
export async function getQsoPage(filters, limit, cursor, offset = 0) {
  var pageQuery = buildQsoPageQuery(filters, limit, cursor, offset);
  var result;
  try {
    result = await queryDatabase(pageQuery.statement, pageQuery.values);
  } catch (error) {
    // 个别旧 SQLite/ROM 对复合游标查询兼容性不佳；仅“加载更多”时按偏移降级。
    if (!pageQuery.usesCursor) throw error;
    pageQuery = buildQsoPageQuery(filters, limit, null, offset, true);
    result = await queryDatabase(pageQuery.statement, pageQuery.values);
  }
  var rows = result.values || [];
  var qsos = rows.slice(0, pageQuery.pageSize);
  var last = qsos.length ? qsos[qsos.length - 1] : null;
  return {
    qsos: qsos,
    hasMore: rows.length > pageQuery.pageSize,
    nextCursor: rows.length > pageQuery.pageSize && last
      ? { qso_date: last.qso_date, time_on: last.time_on || '', id: last.id }
      : null
  };
}

/** 按主键顺序分页导出完整记录，内存占用与日志总量无关。 */
export async function getQsoExportPage(afterId, limit) {
  var pageSize = Math.max(1, Math.min(Number(limit) || 250, 500));
  var cursorId = Math.max(0, Number(afterId) || 0);
  var result = await db().query({
    database: DBNAME,
    statement: 'SELECT * FROM qsos WHERE id > ? ORDER BY id ASC LIMIT ?',
    values: [cursorId, pageSize + 1]
  });
  var rows = result.values || [];
  var qsos = rows.slice(0, pageSize);
  return {
    qsos: qsos,
    hasMore: rows.length > pageSize,
    nextId: qsos.length ? qsos[qsos.length - 1].id : cursorId
  };
}

export async function getQsoById(id) {
  var r = await queryDatabase('SELECT * FROM qsos WHERE id = ?', [id]);
  return (r.values && r.values.length) ? r.values[0] : null;
}

/**
 * 精确按呼号读取近期对方资料。由用户在新建页手动触发，固定上限避免大日志占用内存。
 */
export function buildCounterpartHistoryQuery(callsign, limit = 50) {
  var normalizedCallsign = String(callsign || '').trim().toUpperCase();
  var rowLimit = Math.max(1, Math.min(Number(limit) || 50, 100));
  return {
    statement: "SELECT operator_name, qth, locator, their_rig, their_antenna, their_power, qso_date, time_on " +
    "FROM qsos WHERE callsign = ? " +
    "AND (COALESCE(operator_name, '') != '' OR COALESCE(qth, '') != '' OR COALESCE(locator, '') != '' " +
    "OR COALESCE(their_rig, '') != '' OR COALESCE(their_antenna, '') != '' OR COALESCE(their_power, '') != '') " +
    "ORDER BY qso_date DESC, time_on DESC, id DESC LIMIT ?",
    values: [normalizedCallsign, rowLimit]
  };
}

export async function getCounterpartHistory(callsign, limit = 50) {
  var normalizedCallsign = String(callsign || '').trim().toUpperCase();
  if (!normalizedCallsign) return [];
  var query = buildCounterpartHistoryQuery(normalizedCallsign, limit);
  var r = await queryDatabase(query.statement, query.values);
  return r.values || [];
}

export async function saveQso(data) {
  var now = Date.now();
  var vals = qsoInsertValues(data, now);
  var r = await db().run({ database: DBNAME, statement: QSO_INSERT_SQL, values: vals });
  return r && r.changes ? r.changes.lastId : null;
}

function qsoInsertValues(data, now) {
  return [
    data.callsign||'', data.operator_name||'', data.qth||'', data.locator||'',
    data.rst_sent||'', data.rst_rcvd||'', data.qsl_considered ? 1 : 0, data.mode||'', data.band||'', data.frequency ?? null,
    data.qso_date||'', data.time_on||'', data.time_off||'',
    data.my_lat ?? null, data.my_lon ?? null, data.my_alt ?? null, data.my_locator||'',
    data.my_power ?? null, data.my_antenna ?? null, data.my_rig ?? null,
    data.their_power ?? null, data.their_rig ?? null, data.their_antenna ?? null,
    data.notes||'', data.station_callsign||'', now, now
  ];
}

/**
 * 批量导入一组已验证的 QSO。重复查询、插入和更新都在一次原生事务中完成，
 * 避免大型 ADIF 为每条记录往返一次 JS/Native 桥。
 */
export async function importQsoBatch(items, overwriteDuplicates, inImportTransaction = false) {
  var source = Array.isArray(items) ? items : [];
  if (!source.length) return { imported: 0, overwritten: 0, skipped: 0 };

  // 同一个 ADIF 内也可能重复。覆盖模式保留最后一条，跳过模式保留第一条。
  var uniqueByKey = new Map();
  var skipped = 0;
  for (var i = 0; i < source.length; i++) {
    var item = source[i];
    var key = qsoDuplicateKey(item);
    if (uniqueByKey.has(key)) {
      skipped++;
      if (overwriteDuplicates) uniqueByKey.set(key, item);
    } else {
      uniqueByKey.set(key, item);
    }
  }
  var records = Array.from(uniqueByKey.values());

  var duplicateConditions = [];
  var duplicateValues = [];
  for (var j = 0; j < records.length; j++) {
    duplicateConditions.push('(callsign = ? AND qso_date = ? AND time_on = ? AND band = ?)');
    duplicateValues.push(records[j].callsign, records[j].qso_date, records[j].time_on, records[j].band);
  }
  var existingResult = await db().query({
    database: DBNAME,
    statement: 'SELECT id, callsign, qso_date, time_on, band FROM qsos WHERE ' + duplicateConditions.join(' OR '),
    values: duplicateValues
  });
  var existingByKey = new Map();
  for (var k = 0; k < (existingResult.values || []).length; k++) {
    var existing = existingResult.values[k];
    var existingKey = qsoDuplicateKey(existing);
    if (!existingByKey.has(existingKey)) existingByKey.set(existingKey, existing.id);
  }

  var now = Date.now();
  var statements = [];
  var imported = 0;
  var overwritten = 0;
  for (var n = 0; n < records.length; n++) {
    var qso = records[n];
    var existingId = existingByKey.get(qsoDuplicateKey(qso));
    if (existingId != null) {
      if (!overwriteDuplicates) {
        skipped++;
        continue;
      }
      var fields = QSO_IMPORT_FIELDS.filter(function(field) {
        return Object.prototype.hasOwnProperty.call(qso, field) && qso[field] !== undefined;
      });
      if (!fields.length) {
        skipped++;
        continue;
      }
      var updateValues = fields.map(function(field) {
        return field === 'qsl_considered' ? (qso[field] ? 1 : 0) : qso[field];
      });
      updateValues.push(now, existingId);
      statements.push({
        statement: 'UPDATE qsos SET ' + fields.map(function(field) { return field + ' = ?'; }).join(', ') + ', updated_at = ? WHERE id = ?',
        values: updateValues
      });
      overwritten++;
    } else {
      statements.push({ statement: QSO_INSERT_SQL, values: qsoInsertValues(qso, now) });
      imported++;
    }
  }

  if (statements.length) {
    await db().executeSet({
      database: DBNAME,
      set: statements,
      transaction: !inImportTransaction
    });
  }
  return { imported: imported, overwritten: overwritten, skipped: skipped };
}

/** 整个 ADIF 文件使用一个事务；任何解析/写入失败都不会留下半份导入结果。 */
export async function beginQsoImport() {
  await db().beginTransaction({ database: DBNAME });
}

export async function commitQsoImport() {
  await db().commitTransaction({ database: DBNAME });
}

export async function rollbackQsoImport() {
  await db().rollbackTransaction({ database: DBNAME });
}

function qsoDuplicateKey(data) {
  return JSON.stringify([data.callsign || '', data.qso_date || '', data.time_on || '', data.band || '']);
}

export async function updateQso(id, data) {
  var now = Date.now();
  var sql = 'UPDATE qsos SET callsign=?, operator_name=?, qth=?, locator=?, rst_sent=?, rst_rcvd=?, qsl_considered=?, mode=?, band=?, frequency=?, qso_date=?, time_on=?, time_off=?, my_lat=?, my_lon=?, my_alt=?, my_locator=?, my_power=?, my_antenna=?, my_rig=?, their_power=?, their_rig=?, their_antenna=?, notes=?, station_callsign=?, updated_at=? WHERE id=?';
  var vals = [
    data.callsign||'', data.operator_name||'', data.qth||'', data.locator||'',
    data.rst_sent||'', data.rst_rcvd||'', data.qsl_considered ? 1 : 0, data.mode||'', data.band||'', data.frequency ?? null,
    data.qso_date||'', data.time_on||'', data.time_off||'',
    data.my_lat ?? null, data.my_lon ?? null, data.my_alt ?? null, data.my_locator||'',
    data.my_power ?? null, data.my_antenna ?? null, data.my_rig ?? null,
    data.their_power ?? null, data.their_rig ?? null, data.their_antenna ?? null,
    data.notes||'', data.station_callsign||'', now, id
  ];
  await db().run({ database: DBNAME, statement: sql, values: vals });
}

export async function deleteQso(id) {
  await db().run({ database: DBNAME, statement: 'DELETE FROM qsos WHERE id = ?', values: [id] });
}

export async function checkDuplicate(data, excludeId) {
  var sql = 'SELECT id FROM qsos WHERE callsign = ? AND qso_date = ? AND time_on = ? AND band = ?';
  var params = [data.callsign, data.qso_date, data.time_on, data.band];
  if (excludeId != null) { sql += ' AND id != ?'; params.push(excludeId); }
  var r = await queryDatabase(sql, params);
  return (r.values && r.values.length) ? r.values[0].id : null;
}

// ========== 统计 ==========
export async function getMonthlyCount() {
  var now = new Date();
  var year = now.getUTCFullYear();
  var month = now.getUTCMonth();
  var start = year + String(month + 1).padStart(2, '0') + '01';
  var nextDate = new Date(Date.UTC(year, month + 1, 1));
  var end = nextDate.getUTCFullYear() + String(nextDate.getUTCMonth() + 1).padStart(2, '0') + '01';
  var r = await queryDatabase('SELECT COUNT(*) as cnt FROM qsos WHERE qso_date >= ? AND qso_date < ?', [start, end]);
  return (r.values && r.values.length) ? r.values[0].cnt : 0;
}

export async function getTotalCount() {
  var r = await queryDatabase('SELECT COUNT(*) as cnt FROM qsos', []);
  return (r.values && r.values.length) ? r.values[0].cnt : 0;
}

export async function getBandCounts() {
  var r = await queryDatabase("SELECT band, COUNT(*) as count FROM qsos WHERE band IS NOT NULL AND band != '' GROUP BY band ORDER BY count DESC", []);
  return r.values || [];
}

// ========== 中继台 CRUD ==========
export async function getAllRepeaters() {
  var r = await queryDatabase('SELECT * FROM repeaters ORDER BY created_at DESC', []);
  return r.values || [];
}

export async function saveRepeater(data) {
  var now = Date.now();
  var sql = 'INSERT INTO repeaters (name, rx_frequency, tx_frequency, tx_tone, rx_tone, location, notes, created_at) VALUES (?,?,?,?,?,?,?,?)';
  var r = await db().run({ database: DBNAME, statement: sql, values: [data.name||'', data.rx_frequency ?? null, data.tx_frequency ?? null, data.tx_tone||'', data.rx_tone||'', data.location||'', data.notes||'', now] });
  return r && r.changes ? r.changes.lastId : null;
}

export async function updateRepeater(id, data) {
  var sql = 'UPDATE repeaters SET name=?, rx_frequency=?, tx_frequency=?, tx_tone=?, rx_tone=?, location=?, notes=? WHERE id=?';
  await db().run({ database: DBNAME, statement: sql, values: [data.name||'', data.rx_frequency ?? null, data.tx_frequency ?? null, data.tx_tone||'', data.rx_tone||'', data.location||'', data.notes||'', id] });
}

export async function deleteRepeater(id) {
  await db().run({ database: DBNAME, statement: 'DELETE FROM repeaters WHERE id = ?', values: [id] });
}

/** 用个人信息备份中的中继台完整替换本机列表。 */
export async function replaceAllRepeaters(items) {
  var repeaters = Array.isArray(items) ? items : [];
  var sqlite = db();
  await sqlite.beginTransaction({ database: DBNAME });
  try {
    await sqlite.run({
      database: DBNAME,
      statement: 'DELETE FROM repeaters',
      values: [],
      transaction: false
    });
    var now = Date.now();
    var sql = 'INSERT INTO repeaters (name, rx_frequency, tx_frequency, tx_tone, rx_tone, location, notes, created_at) VALUES (?,?,?,?,?,?,?,?)';
    for (var i = 0; i < repeaters.length; i++) {
      var item = repeaters[i] || {};
      await sqlite.run({
        database: DBNAME,
        statement: sql,
        values: [item.name||'', item.rx_frequency ?? null, item.tx_frequency ?? null, item.tx_tone||'', item.rx_tone||'', item.location||'', item.notes||'', now - i],
        transaction: false
      });
    }
    await sqlite.commitTransaction({ database: DBNAME });
  } catch (error) {
    try { await sqlite.rollbackTransaction({ database: DBNAME }); }
    catch (rollbackError) { /* 保留原始错误 */ }
    throw error;
  }
}
