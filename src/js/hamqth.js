/* ============================================================
   hamqth.js - HamQTH 呼号查询 API 封装
   - 使用 XML API（非 JSON），DOMParser 解析
   - Session 缓存 1 小时自动复用
   - 10 秒超时 + AbortController
   - 自动重试 Session 过期
   ============================================================ */

import { requestCallbookXml } from './callbook-http.js';
import { parseCallbookXml, xmlNode, xmlText, normalizeCallbookLocation } from './callbook-data.js';
import { loadHamQthCredentials } from './secure-data.js';

const HAMQTH_BASE = 'https://www.hamqth.com/xml.php';
const SESSION_KEY = 'hamlog_hamqth_session';
const SESSION_TTL = 3600000; // 1 小时（毫秒）
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
  if (/session.*(?:does not exist|expired|invalid)/i.test(message)) {
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
  const doc = parseCallbookXml(await requestCallbookXml(url, { service: 'HamQTH' }), 'HamQTH');

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
  const doc = parseCallbookXml(await requestCallbookXml(url, { service: 'HamQTH' }), 'HamQTH');

  // 检查 Session 过期
  const errorInfo = getXmlError(doc);
  if (errorInfo) {
    if (errorInfo.sessionExpired) {
      // 返回特殊标记让外层重试
      return { _sessionExpired: true };
    }
    throw new Error(errorInfo.error);
  }

  return readHamQthCallsignInfo(doc);
}

export function readHamQthCallsignInfo(doc) {
  const search = xmlNode(doc, 'search');
  if (!search || !xmlText(search, 'callsign')) throw new Error('未找到该呼号信息');
  return {
    name: xmlText(search, 'nick') || xmlText(search, 'name') || xmlText(search, 'adr_name'),
    qth: xmlText(search, 'qth') || [xmlText(search, 'adr_city'), xmlText(search, 'adr_country')].filter(Boolean).join(', '),
    ...normalizeCallbookLocation(xmlText(search, 'latitude'), xmlText(search, 'longitude'), xmlText(search, 'grid'))
  };
}

export async function testHamQthConnection() {
  clearSessionCache();
  await hamqthLogin();
  return 'HamQTH 登录验证成功';
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
