import test from 'node:test';
import assert from 'node:assert/strict';

import { buildCounterpartProfiles, getCounterpartProfileValues } from '../src/js/counterpart-profiles.js';
import { buildCounterpartHistoryQuery } from '../src/js/db.js';

test('历史资料查询使用大写精确呼号并限制读取数量', () => {
  const query = buildCounterpartHistoryQuery(' bh4abc/p ', 500);
  assert.match(query.statement, /WHERE callsign = \?/);
  assert.doesNotMatch(query.statement, /LIKE/);
  assert.deepEqual(query.values, ['BH4ABC/P', 100]);
});

test('空资料会忽略，完全相同资料会合并并保留最近记录', () => {
  const rows = [
    {
      operator_name: '张三', qth: '上海', locator: 'pm01aa',
      their_rig: 'IC-705', their_antenna: 'EFHW', their_power: '10W',
      qso_date: '20260810', time_on: '120000'
    },
    {
      operator_name: '张三', qth: '上海', locator: 'PM01AA',
      their_rig: 'IC-705', their_antenna: 'EFHW', their_power: '10W',
      qso_date: '20260701', time_on: '080000'
    },
    { operator_name: '', qth: '', locator: '', their_rig: '', their_antenna: '', their_power: '' }
  ];
  const profiles = buildCounterpartProfiles(rows);
  assert.equal(profiles.length, 1);
  assert.equal(profiles[0].qso_date, '20260810');
  assert.equal(profiles[0].locator, 'PM01AA');
  assert.equal(profiles[0].recentUseCount, 2);
});

test('候选资料保持不同组合且只返回可填写字段', () => {
  const profiles = buildCounterpartProfiles([
    { qth: '上海', their_rig: 'IC-705', qso_date: '20260810' },
    { qth: '苏州', their_rig: 'FT-891', qso_date: '20260809' }
  ], 1);
  assert.equal(profiles.length, 1);
  assert.deepEqual(getCounterpartProfileValues(profiles[0]), {
    qth: '上海',
    their_rig: 'IC-705'
  });
});
