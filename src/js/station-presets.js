export const QSO_DEFAULTS_KEY = 'hamlog_qso_defaults';

export function normalizeQsoDefaults(value) {
  if (value == null) return { frequency: null, rig: '', power: null };
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error('通联默认值无效');
  const positiveNumber = (raw, label) => {
    if (raw == null || String(raw).trim() === '') return null;
    const number = Number(raw);
    if (!Number.isFinite(number) || number <= 0) throw new Error(`${label}应为大于 0 的数字`);
    return number;
  };
  const rig = String(value.rig || '').trim();
  if (rig.length > 128) throw new Error('默认设备名称过长');
  return {
    frequency: positiveNumber(value.frequency, '默认频率'),
    rig,
    power: positiveNumber(value.power, '默认功率')
  };
}

export function readQsoDefaults() {
  try { return normalizeQsoDefaults(JSON.parse(localStorage.getItem(QSO_DEFAULTS_KEY) || 'null')); }
  catch { return normalizeQsoDefaults(null); }
}

export function repeaterFrequencyOptions(repeaters) {
  return repeaters.flatMap(repeater => ['rx', 'tx'].flatMap(direction => {
    const frequency = Number(repeater[`${direction}_frequency`]);
    if (!Number.isFinite(frequency) || frequency <= 0) return [];
    return [{
      value: frequency,
      label: `${repeater.name} · ${direction === 'rx' ? '接收' : '发射'} ${frequency} MHz`
    }];
  }));
}
