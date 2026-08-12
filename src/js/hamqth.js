/* ============================================================
   hamqth.js - HamQTH 呼号查询 API 封装
   - 使用 XML API（非 JSON），DOMParser 解析
   - Session 缓存 1 小时自动复用
   - 10 秒超时 + AbortController
   - 自动重试 Session 过期
   ============================================================ */

import { latLngToLocator, isValidLocator, normalizeLocator } from './locator.js';
import { loadHamQthCredentials } from './secure-data.js';

const HAMQTH_BASE = 'https://www.hamqth.com/xml.php';
const SESSION_KEY = 'hamlog_hamqth_session';
const SESSION_TTL = 3600000; // 1 小时（毫秒）
const REQUEST_TIMEOUT = 10000; // 10 秒

/**
 * 带超时的 fetch 封装
 * @param {string} url
 * @param {number} timeoutMs
 * @returns {Promise<Response>}
 */
async function fetchWithTimeout(url, timeoutMs = REQUEST_TIMEOUT) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      cache: 'no-store',
      credentials: 'omit',
      referrerPolicy: 'no-referrer'
    });
    if (!response.ok) throw new Error(`HamQTH 服务返回 HTTP ${response.status}`);
    return response;
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error('查询超时，请检查网络连接');
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 解析 HamQTH XML 响应
 * @param {string} xmlText
 * @returns {Document} 解析后的 XML Document
 */
function parseXml(xmlText) {
  const parser = new DOMParser();
  const document = parser.parseFromString(xmlText, 'text/xml');
  if (document.querySelector('parsererror')) {
    throw new Error('HamQTH 返回了无法解析的数据');
  }
  return document;
}

/**
 * 从 XML 节点中读取第一个非空标签值。
 * HamQTH XML 使用默认命名空间；getElementsByTagNameNS 作为兼容兜底。
 * @param {Document|Element} root
 * @param {...string} tagNames
 * @returns {string}
 */
function getFirstTagText(root, ...tagNames) {
  for (const tagName of tagNames) {
    const directNodes = root?.getElementsByTagName?.(tagName);
    const directText = directNodes?.[0]?.textContent?.trim();
    if (directText) return directText;

    const namespacedNodes = root?.getElementsByTagNameNS?.('*', tagName);
    const namespacedText = namespacedNodes?.[0]?.textContent?.trim();
    if (namespacedText) return namespacedText;
  }
  return '';
}

/**
 * 构建 HamQTH 官方 XML API 登录地址。
 * 官方参数名为 u / p，而不是 username / password。
 * @param {string} username
 * @param {string} password
 * @returns {string}
 */
export function buildHamQthLoginUrl(username, password) {
  return `${HAMQTH_BASE}?u=${encodeURIComponent(username)}&p=${encodeURIComponent(password)}&prg=hamlogbook`;
}

/**
 * 从登录响应中提取 Session ID。
 * 当前官方字段是 session_id，保留 id 仅用于兼容旧响应。
 * @param {Document} doc
 * @returns {string}
 */
export function readHamQthSessionId(doc) {
  return getFirstTagText(doc, 'session_id', 'id');
}

/**
 * 将 HamQTH 原始错误转换为应用可处理的错误。
 * @param {string} errorText
 * @returns {{error: string, sessionExpired: boolean, clearSession: boolean}}
 */
export function classifyHamQthError(errorText) {
  const message = String(errorText || '').trim();
  if (/login failed|wrong|username or password missing/i.test(message)) {
    return {
      error: 'HamQTH 登录失败，请检查用户名和密码',
      sessionExpired: false,
      clearSession: true
    };
  }
  if (/session does not exist/i.test(message)) {
    return { error: message, sessionExpired: true, clearSession: true };
  }
  return {
    error: `HamQTH 错误: ${message || '未知错误'}`,
    sessionExpired: false,
    clearSession: false
  };
}

/**
 * 检查并获取 XML 中的错误信息
 * @param {Document} doc
 * @returns {{error: string, sessionExpired: boolean}|null}
 */
function getXmlError(doc) {
  const errorText = getFirstTagText(doc, 'error');
  if (!errorText) return null;

  const errorInfo = classifyHamQthError(errorText);
  if (errorInfo.clearSession) clearSessionCache();
  return {
    error: errorInfo.error,
    sessionExpired: errorInfo.sessionExpired
  };
}

/**
 * 获取缓存的 Session ID（如果有效）
 * @returns {string|null}
 */
function getCachedSessionId() {
  const cached = sessionStorage.getItem(SESSION_KEY);
  if (!cached) return null;

  try {
    const { id, time } = JSON.parse(cached);
    if (id && time && (Date.now() - time < SESSION_TTL)) {
      return id;
    }
  } catch (e) {
    // 缓存数据损坏，清除
    sessionStorage.removeItem(SESSION_KEY);
    return null;
  }

  // 过期
  sessionStorage.removeItem(SESSION_KEY);
  return null;
}

/**
 * 缓存 Session ID
 * @param {string} id
 */
function cacheSessionId(id) {
  sessionStorage.setItem(SESSION_KEY, JSON.stringify({
    id: id,
    time: Date.now()
  }));
}

/**
 * 清除 Session 缓存
 */
export function clearSessionCache() {
  sessionStorage.removeItem(SESSION_KEY);
}

/**
 * 登录 HamQTH 获取 Session ID
 * @returns {Promise<string>}
 */
async function hamqthLogin() {
  const { username, password } = await loadHamQthCredentials();

  if (!username || !password) {
    throw new Error('请先在设置页配置 HamQTH 账号');
  }

  const url = buildHamQthLoginUrl(username, password);
  const response = await fetchWithTimeout(url);
  const xmlText = await response.text();
  const doc = parseXml(xmlText);

  // 检查登录错误
  const errorInfo = getXmlError(doc);
  if (errorInfo) {
    throw new Error(errorInfo.error);
  }

  // 提取 session id
  const sessionId = readHamQthSessionId(doc);
  if (!sessionId) {
    throw new Error('HamQTH 登录失败：未获取到 Session');
  }
  cacheSessionId(sessionId);
  return sessionId;
}

/**
 * 使用 session ID 查询呼号信息
 * @param {string} sessionId
 * @param {string} callsign
 * @returns {Promise<Object>}
 */
async function hamqthQuery(sessionId, callsign) {
  const url = `${HAMQTH_BASE}?id=${encodeURIComponent(sessionId)}&callsign=${encodeURIComponent(callsign.toUpperCase())}&prg=hamlogbook`;
  const response = await fetchWithTimeout(url);
  const xmlText = await response.text();
  const doc = parseXml(xmlText);

  // 检查 Session 过期
  const errorInfo = getXmlError(doc);
  if (errorInfo) {
    if (errorInfo.sessionExpired) {
      // 返回特殊标记让外层重试
      return { _sessionExpired: true };
    }
    throw new Error(errorInfo.error);
  }

  // 检查是否有搜索结果
  const searchNode = doc.querySelector('search');
  if (!searchNode) {
    throw new Error('未找到该呼号信息');
  }

  // 提取字段
  const callsignResult = searchNode.querySelector('callsign')?.textContent || '';
  if (!callsignResult) {
    throw new Error('未找到该呼号信息');
  }

  // 姓名：优先 nick，其次 name
  const name = searchNode.querySelector('nick')?.textContent?.trim()
            || searchNode.querySelector('name')?.textContent?.trim()
            || '';

  // QTH/位置：优先 qth，其次 adr_city + adr_country
  const qthDirect = searchNode.querySelector('qth')?.textContent?.trim() || '';
  let qth = qthDirect;
  if (!qth) {
    const city = searchNode.querySelector('adr_city')?.textContent?.trim() || '';
    const country = searchNode.querySelector('adr_country')?.textContent?.trim() || '';
    qth = [city, country].filter(Boolean).join(', ');
  }

  // 经纬度和网格
  const latStr = searchNode.querySelector('latitude')?.textContent;
  const lonStr = searchNode.querySelector('longitude')?.textContent;
  const rawGrid = searchNode.querySelector('grid')?.textContent?.trim() || '';

  let lat = null;
  let lon = null;
  let grid = '';

  if (latStr && lonStr) {
    lat = parseFloat(latStr);
    lon = parseFloat(lonStr);
    if (!isNaN(lat) && !isNaN(lon)) {
      // 优先用经纬度计算 6 位网格（最精确）
      grid = latLngToLocator(lat, lon);
    }
  }

  // 如果没有经纬度，用 API 返回的 grid
  if (!grid && rawGrid) {
    const normalizedGrid = normalizeLocator(rawGrid);
    // 异常的 5 位或超长值不应自动写入表单，否则会阻止用户保存 QSO。
    if (isValidLocator(normalizedGrid)) grid = normalizedGrid;
  }

  return {
    callsign: callsignResult,
    name: name,
    qth: qth,
    lat: lat,
    lon: lon,
    grid: grid
  };
}

/**
 * 查询呼号信息（对外主函数）
 * 自动管理 Session 缓存、过期重试
 *
 * @param {string} callsign - 要查询的呼号
 * @returns {Promise<{name: string, qth: string, lat: number|null, lon: number|null, grid: string}>}
 * @throws {Error} 带中文错误描述的异常
 */
export async function queryCallsign(callsign) {
  if (!callsign || !callsign.trim()) {
    throw new Error('请输入呼号');
  }

  callsign = callsign.trim().toUpperCase();

  // 快速离线检查（不完全可靠，但作为第一道防线）
  if (!navigator.onLine) {
    throw new Error('当前处于离线模式，无法查询呼号');
  }

  try {
    // 1. 获取或登录 Session
    let sessionId = getCachedSessionId();
    if (!sessionId) {
      sessionId = await hamqthLogin();
    }

    // 2. 查询呼号
    let result = await hamqthQuery(sessionId, callsign);

    // 3. Session 过期则重新登录后重试一次
    if (result._sessionExpired) {
      sessionId = await hamqthLogin();
      result = await hamqthQuery(sessionId, callsign);
      // 重试后仍有 _sessionExpired 标记则不应出现，但防御一下
      if (result._sessionExpired) {
        throw new Error('HamQTH Session 错误，请重新登录');
      }
    }

    return {
      name: result.name,
      qth: result.qth,
      lat: result.lat,
      lon: result.lon,
      grid: result.grid
    };
  } catch (error) {
    // 如果是我们自己抛的带中文的错误，直接转发
    if (error.message && /[一-鿿]/.test(error.message)) {
      throw error;
    }
    // 网络错误
    throw new Error('查询失败：' + (error.message || '网络错误'));
  }
}
