/* ============================================================
   locator.js - Maidenhead Locator 网格坐标计算
   精确实现 6 位网格算法
   ============================================================ */

/**
 * 将经纬度转换为 6 位 Maidenhead 网格坐标
 * @param {number} lat - 纬度 (-90 ~ 90)
 * @param {number} lon - 经度 (-180 ~ 180)
 * @returns {string} 6 位网格字符串，如 "PM01si"
 */
export function latLngToLocator(lat, lon) {
  lat = Number(lat);
  lon = Number(lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    throw new RangeError('经纬度超出有效范围');
  }

  // 90° / 180° 位于网格体系的开区间上界，向内收敛以得到最后一个有效网格。
  if (lat === 90) lat = 90 - Number.EPSILON * 128;
  if (lon === 180) lon = 180 - Number.EPSILON * 256;

  // 偏移到正数范围，避免 JavaScript % 负数问题
  let adjLon = lon + 180;   // 0 ~ 360
  let adjLat = lat + 90;    // 0 ~ 180

  // 第 1 对: Field 字符 (A-R)，20° × 10° 每格
  const lonField = Math.floor(adjLon / 20);
  const lonRem = adjLon % 20;        // 0 ~ 20
  const latField = Math.floor(adjLat / 10);
  const latRem = adjLat % 10;        // 0 ~ 10

  // 第 2 对: Square 数字 (0-9)，2° × 1° 每格
  const lonSquare = Math.floor(lonRem / 2);
  const lonRem2 = lonRem % 2;        // 0 ~ 2
  const latSquare = Math.floor(latRem / 1);
  const latRem2 = latRem % 1;        // 0 ~ 1

  // 第 3 对: Subsquare 字符 (a-x)，5' × 2.5' 每格
  // 5' = 5/60° = 0.08333...°, 2.5' = 2.5/60° = 0.041666...°
  const lonSub = Math.floor(lonRem2 / (5 / 60));
  const latSub = Math.floor(latRem2 / (2.5 / 60));

  const fieldChars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';  // 注意：实际只用到 A-R
  const subChars = 'abcdefghijklmnopqrstuvwxyz';     // 实际只用到 a-x

  return fieldChars[lonField] + fieldChars[latField] +
         String(lonSquare) + String(latSquare) +
         subChars[lonSub] + subChars[latSub];
}

/**
 * 将手动输入的 Maidenhead 网格统一为 AA00aa / AA00 格式。
 * 不截断内容，让调用方可以对错误长度给出明确提示。
 * @param {string} locator
 * @returns {string}
 */
export function normalizeLocator(locator) {
  const value = String(locator ?? '').trim().replace(/\s+/g, '');
  if (value.length < 4) return value.toUpperCase();
  return value.slice(0, 2).toUpperCase()
    + value.slice(2, 4)
    + value.slice(4).toLowerCase();
}

/**
 * 验证 4 位或 6 位 Maidenhead 网格。
 * @param {string} locator
 * @returns {boolean}
 */
export function isValidLocator(locator) {
  return /^[A-R]{2}\d{2}(?:[a-x]{2})?$/.test(normalizeLocator(locator));
}

/**
 * 6 位 Maidenhead 网格坐标反向计算中心经纬度（用于验证/调试）
 * @param {string} locator - 6 位网格字符串
 * @returns {{ lat: number, lon: number }} 网格中心点经纬度
 */
export function locatorToLatLng(locator) {
  locator = normalizeLocator(locator);
  if (!/^[A-R]{2}\d{2}[a-x]{2}$/.test(locator)) {
    throw new Error('网格坐标应为 6 位 Maidenhead 格式');
  }
  const fieldChars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const subChars = 'abcdefghijklmnopqrstuvwxyz';

  const lonField = fieldChars.indexOf(locator[0].toUpperCase());
  const latField = fieldChars.indexOf(locator[1].toUpperCase());
  const lonSquare = parseInt(locator[2], 10);
  const latSquare = parseInt(locator[3], 10);
  const lonSub = subChars.indexOf(locator[4].toLowerCase());
  const latSub = subChars.indexOf(locator[5].toLowerCase());

  // 反算到网格中心点
  const lon = (lonField * 20) + (lonSquare * 2) + (lonSub * (5 / 60)) + (5 / 60 / 2) - 180;
  const lat = (latField * 10) + (latSquare * 1) + (latSub * (2.5 / 60)) + (2.5 / 60 / 2) - 90;

  return { lat: parseFloat(lat.toFixed(6)), lon: parseFloat(lon.toFixed(6)) };
}
