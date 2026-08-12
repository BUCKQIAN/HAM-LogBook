import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

import initSqlJs from 'sql.js';
import { buildQsoPageQuery } from '../src/js/db.js';

const wasmPath = fileURLToPath(new URL('../node_modules/sql.js/dist/sql-wasm.wasm', import.meta.url));

function queryRows(database, pageQuery) {
  const statement = database.prepare(pageQuery.statement);
  statement.bind(pageQuery.values);
  const rows = [];
  while (statement.step()) rows.push(statement.getAsObject());
  statement.free();
  return rows;
}

test('历史页复合游标可以连续读取全部记录且不重复', async () => {
  const SQL = await initSqlJs({ locateFile: () => wasmPath });
  const database = new SQL.Database();
  database.run(`
    CREATE TABLE qsos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      callsign TEXT,
      mode TEXT,
      band TEXT,
      frequency REAL,
      operator_name TEXT,
      qso_date TEXT NOT NULL,
      time_on TEXT,
      rst_sent TEXT,
      rst_rcvd TEXT,
      qsl_considered INTEGER DEFAULT 0
    )
  `);

  const insert = database.prepare('INSERT INTO qsos (callsign, mode, band, qso_date, time_on) VALUES (?, ?, ?, ?, ?)');
  for (let id = 1; id <= 235; id++) {
    // 包含大量相同日期/时间，验证最终会由 id 稳定打破并列。
    insert.run([`BH${id}`, 'FM', id % 2 ? '2m' : '70cm', `202608${String((id % 5) + 1).padStart(2, '0')}`, id % 3 ? '120000' : '']);
  }
  insert.free();

  const collectedIds = [];
  let cursor = null;
  let offset = 0;
  do {
    const pageQuery = buildQsoPageQuery({}, 40, cursor, offset);
    const rows = queryRows(database, pageQuery);
    const page = rows.slice(0, pageQuery.pageSize);
    collectedIds.push(...page.map(row => Number(row.id)));
    offset += page.length;
    const last = page.at(-1);
    cursor = rows.length > pageQuery.pageSize
      ? { qso_date: last.qso_date, time_on: last.time_on || '', id: last.id }
      : null;
  } while (cursor);

  assert.equal(collectedIds.length, 235);
  assert.equal(new Set(collectedIds).size, 235);

  const expected = database.exec("SELECT id FROM qsos ORDER BY qso_date DESC, COALESCE(time_on, '') DESC, id DESC")[0].values.flat();
  assert.deepEqual(collectedIds, expected);
  database.close();
});

test('历史游标查询失败时的 OFFSET 降级保持相同页序', async () => {
  const SQL = await initSqlJs({ locateFile: () => wasmPath });
  const database = new SQL.Database();
  database.run('CREATE TABLE qsos (id INTEGER PRIMARY KEY, callsign TEXT, mode TEXT, band TEXT, frequency REAL, operator_name TEXT, qso_date TEXT, time_on TEXT, rst_sent TEXT, rst_rcvd TEXT, qsl_considered INTEGER)');
  for (let id = 1; id <= 12; id++) database.run('INSERT INTO qsos (id, qso_date, time_on) VALUES (?, ?, ?)', [id, '20260810', '120000']);

  const firstQuery = buildQsoPageQuery({}, 5, null, 0);
  const firstRows = queryRows(database, firstQuery).slice(0, 5);
  const last = firstRows.at(-1);
  const cursor = { qso_date: last.qso_date, time_on: last.time_on, id: last.id };
  const cursorRows = queryRows(database, buildQsoPageQuery({}, 5, cursor, 5)).slice(0, 5);
  const offsetRows = queryRows(database, buildQsoPageQuery({}, 5, null, 5, true)).slice(0, 5);

  assert.deepEqual(offsetRows.map(row => row.id), cursorRows.map(row => row.id));
  database.close();
});

test('呼号筛选使用可命中索引的前缀范围而不是全表模糊扫描', () => {
  const query = buildQsoPageQuery({ callsign: ' bh4 ' }, 20, null, 0);
  assert.match(query.statement, /callsign >= \? AND callsign < \?/);
  assert.deepEqual(query.values.slice(0, 2), ['BH4', 'BH4\uffff']);
  assert.doesNotMatch(query.statement, /LIKE/);
});
