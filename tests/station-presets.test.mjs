import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeQsoDefaults, repeaterFrequencyOptions } from '../src/js/station-presets.js';

test('通联默认值允许留空，统一数字与设备名称', () => {
  assert.deepEqual(normalizeQsoDefaults(null), { frequency: null, rig: '', power: null });
  assert.deepEqual(normalizeQsoDefaults({ frequency: '144.370', rig: ' FT-60 ', power: '5' }), {
    frequency: 144.37, rig: 'FT-60', power: 5
  });
});
test('无效的默认频率和功率不会进入持久设置或备份恢复', () => {
  for (const frequency of [0, -1, 'abc', Infinity]) assert.throws(() => normalizeQsoDefaults({ frequency }), /默认频率/);
  assert.throws(() => normalizeQsoDefaults({ power: -5 }), /默认功率/);
});
test('中继选择区分收发频率并过滤缺失或无效的频率', () => {
  const options = repeaterFrequencyOptions([
    { name: '本地中继', rx_frequency: 439.65, tx_frequency: 434.65 },
    { name: '旧中继', rx_frequency: null, tx_frequency: -1 }
  ]);
  assert.deepEqual(options.map(item => item.value), [439.65, 434.65]);
  assert.match(options[0].label, /接收/);
  assert.match(options[1].label, /发射/);
});
