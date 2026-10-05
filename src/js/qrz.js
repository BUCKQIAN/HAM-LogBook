import { loadQrzCredentials } from './secure-data.js';
import { requestCallbookXml } from './callbook-http.js';
import { parseCallbookXml, xmlNode, xmlText, normalizeCallbookLocation } from './callbook-data.js';

const BASE = 'https://xmldata.qrz.com/xml/current/';
export const QRZ_SESSION_KEY = 'hamlog_qrz_session';

export function classifyQrzError(message) {
  if (/session|timeout|invalid key/i.test(message)) return { expired: true, message: 'QRZ 会话已过期' };
  if (/subscription|subscriber/i.test(message)) return { expired: false, message: 'QRZ 完整资料查询需要有效的 XML 订阅' };
  if (/password|username|login/i.test(message)) return { expired: false, message: 'QRZ 登录失败，请检查用户名和密码' };
  if (/not found/i.test(message)) return { expired: false, message: 'QRZ 未找到该呼号' };
  return { expired: false, message: `QRZ 错误：${message || '响应不完整'}` };
}

async function login() {
  const { username, password } = await loadQrzCredentials();
  if (!username || !password) throw new Error('请先在设置中配置 QRZ 账号与 XML 订阅');
  const data = new URLSearchParams({ username, password, agent: 'hamlogbook' }).toString();
  const doc = parseCallbookXml(await requestCallbookXml(BASE, { service: 'QRZ', method: 'POST', data }), 'QRZ');
  const session = xmlNode(doc, 'Session');
  const error = xmlText(session, 'Error');
  if (error) throw new Error(classifyQrzError(error).message);
  const key = xmlText(session, 'Key');
  if (!key) throw new Error('QRZ 登录失败：未获取到会话');
  sessionStorage.setItem(QRZ_SESSION_KEY, key);
  return { key, message: xmlText(session, 'SubExp') === 'non-subscriber' ? '登录成功；完整资料查询需要 XML 订阅' : 'QRZ 登录验证成功' };
}

export async function testQrzConnection() {
  sessionStorage.removeItem(QRZ_SESSION_KEY);
  return (await login()).message;
}

export async function queryQrzCallsign(value) {
  const callsign = String(value || '').trim().toUpperCase();
  if (!callsign) throw new Error('请输入呼号');
  if (!navigator.onLine) throw new Error('当前处于离线模式，无法查询呼号');
  let key = sessionStorage.getItem(QRZ_SESSION_KEY) || (await login()).key;
  for (let attempt = 0; attempt < 2; attempt++) {
    const query = new URLSearchParams({ s: key, callsign });
    const doc = parseCallbookXml(await requestCallbookXml(`${BASE}?${query}`, { service: 'QRZ' }), 'QRZ');
    const session = xmlNode(doc, 'Session');
    const nextKey = xmlText(session, 'Key');
    const errorText = xmlText(session, 'Error');
    const error = errorText ? classifyQrzError(errorText) : null;
    if (error?.expired || (!error && !nextKey)) {
      sessionStorage.removeItem(QRZ_SESSION_KEY);
      if (attempt === 0) { key = (await login()).key; continue; }
      throw new Error('QRZ 会话失效，请重新验证账号');
    }
    if (nextKey) sessionStorage.setItem(QRZ_SESSION_KEY, nextKey);
    if (error) throw new Error(error.message);
    const node = xmlNode(doc, 'Callsign');
    if (!node || !xmlText(node, 'call')) throw new Error('QRZ 未找到该呼号');
    if (!xmlText(node, 'fname') && !xmlText(node, 'name') && !xmlText(node, 'addr2') && !xmlText(node, 'grid')) {
      throw new Error('QRZ 未返回可填充的资料，请检查 XML 订阅');
    }
    return {
      name: xmlText(node, 'nickname') || [xmlText(node, 'fname'), xmlText(node, 'name')].filter(Boolean).join(' '),
      qth: [xmlText(node, 'addr2'), xmlText(node, 'state'), xmlText(node, 'country')].filter(Boolean).join(', '),
      ...normalizeCallbookLocation(xmlText(node, 'lat'), xmlText(node, 'lon'), xmlText(node, 'grid')),
      warning: xmlText(session, 'Message')
    };
  }
}
