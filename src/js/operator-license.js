/* ============================================================
   operator-license.js - 中国大陆操作证类别与新建 QSO 频段权限
   类别设置只约束应用的新记录选项，不替代电台执照载明范围。
   ============================================================ */

import { SUPPORTED_BANDS } from './radio.js';

export const CN_OPERATOR_CLASS_KEY = 'hamlog_operator_class_cn';
export const CN_OPERATOR_CLASSES = ['A', 'B', 'C'];

const A_CLASS_BANDS = ['6m', '2m', '70cm'];

export function isValidCnOperatorClass(value) {
  return CN_OPERATOR_CLASSES.includes(String(value || '').trim().toUpperCase());
}

export function normalizeCnOperatorClass(value) {
  const normalized = String(value || '').trim().toUpperCase();
  return isValidCnOperatorClass(normalized) ? normalized : 'A';
}

export function getAllowedBandIds(operatorClass) {
  const normalized = normalizeCnOperatorClass(operatorClass);
  return normalized === 'A' ? [...A_CLASS_BANDS] : [...SUPPORTED_BANDS];
}

export function isBandAllowedForNewQso(band, operatorClass) {
  return getAllowedBandIds(operatorClass).includes(String(band || '').trim().toLowerCase());
}

export function getStoredCnOperatorClass(storage = globalThis.localStorage) {
  try {
    return normalizeCnOperatorClass(storage?.getItem(CN_OPERATOR_CLASS_KEY));
  } catch (error) {
    return 'A';
  }
}

export function storeCnOperatorClass(value, storage = globalThis.localStorage) {
  const normalized = normalizeCnOperatorClass(value);
  storage?.setItem(CN_OPERATOR_CLASS_KEY, normalized);
  return normalized;
}
