import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildHamQthLoginUrl,
  classifyHamQthError,
  readHamQthSessionId
} from '../src/js/hamqth.js';

function fakeXmlDocument(values) {
  return {
    getElementsByTagName(tagName) {
      if (!Object.hasOwn(values, tagName)) return [];
      return [{ textContent: values[tagName] }];
    },
    getElementsByTagNameNS(_namespace, tagName) {
      if (!Object.hasOwn(values, tagName)) return [];
      return [{ textContent: values[tagName] }];
    }
  };
}

test('HamQTH 登录使用官方 u / p 参数并正确编码凭据', () => {
  const url = new URL(buildHamQthLoginUrl('BG0/TEST', 'p& ss?'));

  assert.equal(url.origin + url.pathname, 'https://www.hamqth.com/xml.php');
  assert.equal(url.searchParams.get('u'), 'BG0/TEST');
  assert.equal(url.searchParams.get('p'), 'p& ss?');
  assert.equal(url.searchParams.get('prg'), 'hamlogbook');
  assert.equal(url.searchParams.has('username'), false);
  assert.equal(url.searchParams.has('password'), false);
});

test('HamQTH 登录响应优先读取官方 session_id', () => {
  const doc = fakeXmlDocument({ session_id: ' current-session ', id: 'legacy-session' });
  assert.equal(readHamQthSessionId(doc), 'current-session');
});

test('HamQTH 登录响应兼容旧 id 字段', () => {
  const doc = fakeXmlDocument({ id: ' legacy-session ' });
  assert.equal(readHamQthSessionId(doc), 'legacy-session');
});

test('HamQTH 缺少凭据和错误凭据都映射为明确登录错误', () => {
  for (const message of ['Username or password missing', 'Wrong user name or password']) {
    assert.deepEqual(classifyHamQthError(message), {
      error: 'HamQTH 登录失败，请检查用户名和密码',
      sessionExpired: false,
      clearSession: true
    });
  }
});

test('HamQTH Session 失效允许上层重新登录', () => {
  assert.deepEqual(classifyHamQthError('Session does not exist or expired'), {
    error: 'Session does not exist or expired',
    sessionExpired: true,
    clearSession: true
  });
});
