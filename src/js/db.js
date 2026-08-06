/* ============================================================
   db.js - SQLite 数据库单例封装
   直接使用 window.CapacitorSQLite（不依赖 SQLiteConnection 封装）
   ============================================================ */

var CAPSQL = null;
var DBNAME = 'hamlogbook';

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
  'rst_sent TEXT, rst_rcvd TEXT, mode TEXT, band TEXT, frequency REAL, qso_date TEXT NOT NULL, ' +
  'time_on TEXT, time_off TEXT, my_lat REAL, my_lon REAL, my_alt REAL, my_locator TEXT, ' +
  'my_power TEXT, my_antenna TEXT, my_rig TEXT, their_power TEXT, their_rig TEXT, their_antenna TEXT, ' +
  'notes TEXT, station_callsign TEXT, created_at INTEGER, updated_at INTEGER)';

var CREATE_TABLE_REPEATERS = 'CREATE TABLE IF NOT EXISTS repeaters (' +
  'id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, rx_frequency REAL, tx_frequency REAL, ' +
  'tx_tone TEXT, rx_tone TEXT, location TEXT, notes TEXT, created_at INTEGER)';

var CREATE_INDEXES = [
  'CREATE INDEX IF NOT EXISTS idx_qso_callsign ON qsos(callsign)',
  'CREATE INDEX IF NOT EXISTS idx_qso_date ON qsos(qso_date)',
  'CREATE INDEX IF NOT EXISTS idx_qso_band ON qsos(band)',
  'CREATE INDEX IF NOT EXISTS idx_qso_mode ON qsos(mode)'
];

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
  await addColumnIfMissing(sqlite, 'qsos', 'my_rig', 'TEXT');
  await addColumnIfMissing(sqlite, 'qsos', 'my_locator', 'TEXT');
  await addColumnIfMissing(sqlite, 'qsos', 'station_callsign', 'TEXT');

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
    console.log('SQLite reusing native connection; open:', isOpen);
  } catch (probeError) {
    // “No available connection” 是首次启动的正常状态，随后才创建连接。
    console.log('SQLite has no registered connection yet');
  }

  if (!connectionExists) {
    try {
      await s.createConnection({
        database: DBNAME,
        encrypted: false,
        mode: 'no-encryption',
        version: 1,
        readonly: false
      });
    } catch (createError) {
      // 探测和创建之间如有另一页面注册连接，直接复用。
      var createMsg = createError.message || String(createError) || '';
      if (!/already exists|connection .* exists/i.test(createMsg)) {
        throw new Error('建连接失败: ' + createMsg);
      }
      connectionExists = true;
      console.log('SQLite connection registered concurrently; reusing');
    }
  }

  if (!isOpen) {
    try {
      await s.open({ database: DBNAME, readonly: false });
    } catch (openError) {
      var openMsg = openError.message || String(openError) || '';
      // 某些插件版本对已打开连接返回错误；再确认一次真实状态。
      try {
        var retryState = await s.isDBOpen({ database: DBNAME, readonly: false });
        if (!retryState.result) throw openError;
      } catch (verifyError) {
        throw new Error('打开失败: ' + openMsg);
      }
    }
  }

  // 建表
  try { await s.execute({ database: DBNAME, statements: CREATE_TABLE_QSO }); }
  catch (err) { throw new Error('建qsos表: ' + (err.message || String(err))); }

  try { await s.execute({ database: DBNAME, statements: CREATE_TABLE_REPEATERS }); }
  catch (err) { throw new Error('建repeaters表: ' + (err.message || String(err))); }

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

// ========== QSO CRUD ==========
export async function getAllQsos(filters) {
  var f = filters || {};
  var conds = [], params = [];
  if (f.callsign) { conds.push('callsign LIKE ?'); params.push('%' + f.callsign.toUpperCase() + '%'); }
  if (f.dateFrom) { conds.push('qso_date >= ?'); params.push(f.dateFrom); }
  if (f.dateTo) { conds.push('qso_date <= ?'); params.push(f.dateTo); }
  if (f.band) { conds.push('band = ?'); params.push(f.band); }
  if (f.mode) { conds.push('mode = ?'); params.push(f.mode); }
  var where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';
  var sql = 'SELECT * FROM qsos ' + where + ' ORDER BY qso_date DESC, time_on DESC';
  var r = await db().query({ database: DBNAME, statement: sql, values: params });
  return r.values || [];
}

export async function getQsoById(id) {
  var r = await db().query({ database: DBNAME, statement: 'SELECT * FROM qsos WHERE id = ?', values: [id] });
  return (r.values && r.values.length) ? r.values[0] : null;
}

export async function saveQso(data) {
  var now = Date.now();
  var sql = 'INSERT INTO qsos (callsign, operator_name, qth, locator, rst_sent, rst_rcvd, mode, band, frequency, qso_date, time_on, time_off, my_lat, my_lon, my_alt, my_locator, my_power, my_antenna, my_rig, their_power, their_rig, their_antenna, notes, station_callsign, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)';
  var vals = [
    data.callsign||'', data.operator_name||'', data.qth||'', data.locator||'',
    data.rst_sent||'', data.rst_rcvd||'', data.mode||'', data.band||'', data.frequency ?? null,
    data.qso_date||'', data.time_on||'', data.time_off||'',
    data.my_lat ?? null, data.my_lon ?? null, data.my_alt ?? null, data.my_locator||'',
    data.my_power ?? null, data.my_antenna ?? null, data.my_rig ?? null,
    data.their_power ?? null, data.their_rig ?? null, data.their_antenna ?? null,
    data.notes||'', data.station_callsign||'', now, now
  ];
  var r = await db().run({ database: DBNAME, statement: sql, values: vals });
  return r && r.changes ? r.changes.lastId : null;
}

export async function updateQso(id, data) {
  var now = Date.now();
  var sql = 'UPDATE qsos SET callsign=?, operator_name=?, qth=?, locator=?, rst_sent=?, rst_rcvd=?, mode=?, band=?, frequency=?, qso_date=?, time_on=?, time_off=?, my_lat=?, my_lon=?, my_alt=?, my_locator=?, my_power=?, my_antenna=?, my_rig=?, their_power=?, their_rig=?, their_antenna=?, notes=?, station_callsign=?, updated_at=? WHERE id=?';
  var vals = [
    data.callsign||'', data.operator_name||'', data.qth||'', data.locator||'',
    data.rst_sent||'', data.rst_rcvd||'', data.mode||'', data.band||'', data.frequency ?? null,
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
  var r = await db().query({ database: DBNAME, statement: sql, values: params });
  return (r.values && r.values.length) ? r.values[0].id : null;
}

// ========== 统计 ==========
export async function getMonthlyCount() {
  var now = new Date();
  // QSO 日期使用 UTC，因此月统计也必须按 UTC 计算，避免北京时间月初/月底错月。
  var ym = now.getUTCFullYear() + String(now.getUTCMonth() + 1).padStart(2, '0');
  var r = await db().query({ database: DBNAME, statement: "SELECT COUNT(*) as cnt FROM qsos WHERE substr(qso_date,1,6) = ?", values: [ym] });
  return (r.values && r.values.length) ? r.values[0].cnt : 0;
}

export async function getTotalCount() {
  var r = await db().query({ database: DBNAME, statement: 'SELECT COUNT(*) as cnt FROM qsos', values: [] });
  return (r.values && r.values.length) ? r.values[0].cnt : 0;
}

export async function getBandCounts() {
  var r = await db().query({ database: DBNAME, statement: "SELECT band, COUNT(*) as count FROM qsos WHERE band IS NOT NULL AND band != '' GROUP BY band ORDER BY count DESC", values: [] });
  return r.values || [];
}

// ========== 中继台 CRUD ==========
export async function getAllRepeaters() {
  var r = await db().query({ database: DBNAME, statement: 'SELECT * FROM repeaters ORDER BY created_at DESC', values: [] });
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
