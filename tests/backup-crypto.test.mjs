import test from 'node:test';
import assert from 'node:assert/strict';

import {
  decryptPersonalInfoBackup,
  encryptPersonalInfoBackup,
  isEncryptedPersonalInfoBackup
} from '../src/js/backup-crypto.js';

test('个人信息备份使用口令加密且错误口令无法读取', async () => {
  const original = { station_callsign: 'BH4ABC', default_qth: { lat: 31.2, lon: 121.5 } };
  const encrypted = await encryptPersonalInfoBackup(original, 'correct-horse');
  assert.equal(isEncryptedPersonalInfoBackup(encrypted), true);
  assert.equal(JSON.stringify(encrypted).includes('BH4ABC'), false);
  assert.deepEqual(await decryptPersonalInfoBackup(encrypted, 'correct-horse'), original);
  await assert.rejects(decryptPersonalInfoBackup(encrypted, 'wrong-password'), /密码错误|文件已经损坏/);
});

test('个人信息备份拒绝过短密码', async () => {
  await assert.rejects(encryptPersonalInfoBackup({}, 'short'), /至少需要 8/);
});
