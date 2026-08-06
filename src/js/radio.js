/* ============================================================
   radio.js - 业余无线电常用纯函数
   不依赖网络或原生插件，可供表单和 ADIF 导入共同使用
   ============================================================ */

const BAND_RANGES = [
  { min: 50.0, max: 54.0, band: '6m' },
  { min: 144.0, max: 148.0, band: '2m' },
  { min: 430.0, max: 440.0, band: '70cm' }
];

export const SUPPORTED_BANDS = ['6m', '2m', '70cm'];

/** 根据 MHz 频率识别常用业余频段；无法识别时返回空字符串。 */
export function detectBandFromFrequency(value) {
  const frequency = Number(value);
  if (!Number.isFinite(frequency) || frequency <= 0) return '';
  return BAND_RANGES.find(item => frequency >= item.min && frequency <= item.max)?.band || '';
}

/** 规范化 CTCSS / DCS 输入，保留空值。 */
export function normalizeTone(value) {
  return String(value || '').trim().toUpperCase().replace(/\s+/g, '');
}

/** 接受常见 CTCSS 数值或 DCS 三位代码。 */
export function isValidTone(value) {
  const tone = normalizeTone(value);
  return !tone || /^(?:\d{2,3}(?:\.\d)?|DCS\d{3})$/.test(tone);
}
