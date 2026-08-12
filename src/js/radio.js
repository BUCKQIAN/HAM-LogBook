/* ============================================================
   radio.js - 业余无线电常用纯函数
   不依赖网络或原生插件，可供表单和 ADIF 导入共同使用
   ============================================================ */

/**
 * 应用当前收录的常用频段。
 * 这是日志录入/ADIF 导入共用的数据目录；操作证类别只决定新建页显示其中哪些频段。
 */
export const BAND_CATALOG = [
  { id: '160m', label: '160m', min: 1.8, max: 2.0 },
  { id: '80m', label: '80m', min: 3.5, max: 3.9 },
  { id: '40m', label: '40m', min: 7.0, max: 7.2 },
  { id: '30m', label: '30m', min: 10.1, max: 10.15 },
  { id: '20m', label: '20m', min: 14.0, max: 14.35 },
  { id: '17m', label: '17m', min: 18.068, max: 18.168 },
  { id: '15m', label: '15m', min: 21.0, max: 21.45 },
  { id: '12m', label: '12m', min: 24.89, max: 24.99 },
  { id: '10m', label: '10m', min: 28.0, max: 29.7 },
  { id: '6m', label: '6m', min: 50.0, max: 54.0 },
  { id: '2m', label: '2m', min: 144.0, max: 148.0 },
  { id: '70cm', label: '70cm', min: 430.0, max: 440.0 }
];

export const SUPPORTED_BANDS = BAND_CATALOG.map(item => item.id);

/** 根据 MHz 频率识别常用业余频段；无法识别时返回空字符串。 */
export function detectBandFromFrequency(value) {
  const frequency = Number(value);
  if (!Number.isFinite(frequency) || frequency <= 0) return '';
  return BAND_CATALOG.find(item => frequency >= item.min && frequency <= item.max)?.id || '';
}

/**
 * 规范化亚音输入。
 * CTCSS 使用正式的 T88.5 格式，DCS 使用 D023N（N=Normal）格式；
 * 同时兼容旧版保存的 88.5 与 DCS023。
 */
export function normalizeTone(value) {
  const tone = String(value || '').trim().toUpperCase().replace(/\s+/g, '');
  if (!tone) return '';

  const ctcss = /^(?:T)?(\d{2,3}(?:\.\d)?)$/.exec(tone);
  if (ctcss) return `T${Number(ctcss[1]).toFixed(1)}`;

  const dcs = /^(?:D(?:CS)?)?(\d{3})([NI])?$/.exec(tone);
  if (dcs) return `D${dcs[1]}${dcs[2] || 'N'}`;

  return tone;
}

/** 接受正式的 CTCSS（T88.5）或 DCS（D023N / D023I）格式。 */
export function isValidTone(value) {
  const tone = normalizeTone(value);
  return !tone || /^(?:T\d{2,3}\.\d|D\d{3}[NI])$/.test(tone);
}
