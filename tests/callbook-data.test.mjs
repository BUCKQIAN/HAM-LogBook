import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeCallbookLocation } from '../src/js/callbook-data.js';
import { classifyQrzError } from '../src/js/qrz.js';

test('呼号资料中的异常坐标不影响有效网格，也不会被填入表单', () => {
  assert.deepEqual(normalizeCallbookLocation('999', 'NaN', 'pm01ab'), { lat: null, lon: null, grid: 'PM01ab' });
  assert.deepEqual(normalizeCallbookLocation('', '', 'bad'), { lat: null, lon: null, grid: '' });
});
test('缺少有效网格时才用有效经纬度计算，0 度坐标保留', () => {
  assert.equal(normalizeCallbookLocation('0', '0', '').grid, 'JJ00aa');
  assert.equal(normalizeCallbookLocation('31.2', '121.4', 'PM01ab').grid, 'PM01ab');
});
test('QRZ 错误区分订阅、未找到呼号和可重试会话错误', () => {
  assert.equal(classifyQrzError('Session Timeout').expired, true);
  assert.match(classifyQrzError('Subscriber required').message, /订阅/);
  assert.match(classifyQrzError('Callsign not found').message, /未找到/);
});
