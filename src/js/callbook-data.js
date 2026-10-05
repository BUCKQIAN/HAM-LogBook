import { isValidLocator, normalizeLocator, latLngToLocator } from './locator.js';

export function xmlNode(root, tag) {
  return root?.getElementsByTagNameNS?.('*', tag)?.[0] || root?.getElementsByTagName?.(tag)?.[0] || null;
}
export function xmlText(root, tag) { return xmlNode(root, tag)?.textContent?.trim() || ''; }
export function parseCallbookXml(text, service) {
  const doc = new DOMParser().parseFromString(text, 'text/xml');
  if (doc.querySelector('parsererror')) throw new Error(`${service} 返回了无法解析的数据`);
  return doc;
}
export function normalizeCallbookLocation(latValue, lonValue, gridValue) {
  const parseCoordinate = (value, min, max) => {
    if (value == null || String(value).trim() === '') return null;
    const number = Number(value);
    return Number.isFinite(number) && number >= min && number <= max ? number : null;
  };
  const lat = parseCoordinate(latValue, -90, 90);
  const lon = parseCoordinate(lonValue, -180, 180);
  const locator = normalizeLocator(gridValue);
  const grid = isValidLocator(locator) ? locator : (lat !== null && lon !== null ? latLngToLocator(lat, lon) : '');
  return { lat, lon, grid };
}
