import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizePersonalInfoBackup } from '../src/js/settings.js';

function baseBackup(schemaVersion) {
  return {
    format: 'hamlogbook-personal-info',
    schema_version: schemaVersion,
    station_callsign: ' bh4abc ',
    default_qth: null,
    hamqth: { username: '', password: '' },
    rig_presets: [],
    repeaters: []
  };
}

test('个人信息 v1 备份仍可恢复并安全回退为 A 类', () => {
  const normalized = normalizePersonalInfoBackup(baseBackup(1));
  assert.equal(normalized.station_callsign, 'BH4ABC');
  assert.equal(normalized.operator_class, 'A');
});

test('个人信息 v2 备份保留中国操作证类别', () => {
  const backup = baseBackup(2);
  backup.operator_license = { region: 'CN', class: 'c' };
  const normalized = normalizePersonalInfoBackup(backup);
  assert.equal(normalized.operator_class, 'C');
});

test('个人信息 v2 拒绝未知地区或类别', () => {
  const backup = baseBackup(2);
  backup.operator_license = { region: 'CN', class: 'D' };
  assert.throws(() => normalizePersonalInfoBackup(backup), /操作证类别数据无效/);
});

test('个人信息 v3 不要求或恢复 HamQTH 密码', () => {
  const backup = baseBackup(3);
  backup.operator_license = { region: 'CN', class: 'B' };
  backup.hamqth = { username: 'bh4abc', credentials_included: false };
  const normalized = normalizePersonalInfoBackup(backup);
  assert.equal(normalized.hamqth.username, 'bh4abc');
  assert.equal(normalized.hamqth.password, '');
});

test('个人信息 v4 保留默认频率、设备功率与查询源，排除两种账号密码', () => {
  const backup = baseBackup(4);
  backup.operator_license = { region: 'CN', class: 'A' };
  backup.qso_defaults = { frequency: 144.37, rig: 'FT-60', power: 5 };
  backup.callbook_provider = 'qrz';
  backup.qrz = { username: 'bh4abc', password: 'must-not-restore' };
  backup.hamqth.password = 'must-not-restore';
  const normalized = normalizePersonalInfoBackup(backup);
  assert.deepEqual(normalized.qso_defaults, backup.qso_defaults);
  assert.equal(normalized.callbook_provider, 'qrz');
  assert.equal(normalized.qrz.username, 'bh4abc');
  assert.equal(normalized.qrz.password, '');
  assert.equal(normalized.hamqth.password, '');
});

test('旧个人信息备份没有新增预设时恢复为空值，并沿用 HamQTH', () => {
  const normalized = normalizePersonalInfoBackup(baseBackup(1));
  assert.deepEqual(normalized.qso_defaults, { frequency: null, rig: '', power: null });
  assert.equal(normalized.callbook_provider, 'hamqth');
});
