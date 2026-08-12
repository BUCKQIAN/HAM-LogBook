import test from 'node:test';
import assert from 'node:assert/strict';

import { BAND_CATALOG, SUPPORTED_BANDS, detectBandFromFrequency, isValidTone, normalizeTone } from '../src/js/radio.js';

test('旧亚音写法会转换为正式显示格式', () => {
  assert.equal(normalizeTone('88.5'), 'T88.5');
  assert.equal(normalizeTone('DCS023'), 'D023N');
  assert.equal(normalizeTone('d023i'), 'D023I');
});

test('亚音格式校验接受 CTCSS、DCS 和空值', () => {
  assert.equal(isValidTone('T88.5'), true);
  assert.equal(isValidTone('D023N'), true);
  assert.equal(isValidTone(''), true);
  assert.equal(isValidTone('invalid'), false);
});

test('常用频段目录和频率识别覆盖 HF、VHF、UHF', () => {
  assert.deepEqual(SUPPORTED_BANDS, BAND_CATALOG.map(item => item.id));
  assert.equal(detectBandFromFrequency(1.85), '160m');
  assert.equal(detectBandFromFrequency(14.27), '20m');
  assert.equal(detectBandFromFrequency(50.5), '6m');
  assert.equal(detectBandFromFrequency(145.5), '2m');
  assert.equal(detectBandFromFrequency(438.5), '70cm');
  assert.equal(detectBandFromFrequency(5), '');
});
