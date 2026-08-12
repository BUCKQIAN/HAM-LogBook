import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CN_OPERATOR_CLASS_KEY,
  getAllowedBandIds,
  getStoredCnOperatorClass,
  isBandAllowedForNewQso,
  normalizeCnOperatorClass,
  storeCnOperatorClass
} from '../src/js/operator-license.js';
import { SUPPORTED_BANDS } from '../src/js/radio.js';

function memoryStorage(initialValue = null) {
  const values = new Map();
  if (initialValue != null) values.set(CN_OPERATOR_CLASS_KEY, initialValue);
  return {
    getItem: key => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value))
  };
}

test('未设置或无效类别安全回退到 A 类', () => {
  assert.equal(normalizeCnOperatorClass(''), 'A');
  assert.equal(normalizeCnOperatorClass('d'), 'A');
  assert.equal(getStoredCnOperatorClass(memoryStorage()), 'A');
  assert.equal(getStoredCnOperatorClass(memoryStorage('invalid')), 'A');
});

test('A 类固定为 6m、2m、70cm', () => {
  assert.deepEqual(getAllowedBandIds('A'), ['6m', '2m', '70cm']);
  assert.equal(isBandAllowedForNewQso('2m', 'A'), true);
  assert.equal(isBandAllowedForNewQso('20m', 'A'), false);
});

test('B 类和 C 类开放应用支持的全部常用频段', () => {
  assert.deepEqual(getAllowedBandIds('B'), SUPPORTED_BANDS);
  assert.deepEqual(getAllowedBandIds('C'), SUPPORTED_BANDS);
  assert.equal(isBandAllowedForNewQso('160m', 'B'), true);
  assert.equal(isBandAllowedForNewQso('20m', 'C'), true);
});

test('保存类别时统一为大写规范值', () => {
  const storage = memoryStorage();
  assert.equal(storeCnOperatorClass('b', storage), 'B');
  assert.equal(getStoredCnOperatorClass(storage), 'B');
});
