import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';

const sourceRoot = new URL('../src/', import.meta.url);

test('所有页面启用 CSP 且不含内联脚本和事件处理器', async () => {
  const files = (await readdir(sourceRoot)).filter(name => name.endsWith('.html') && !name.startsWith('._'));
  for (const file of files) {
    const html = await readFile(new URL(file, sourceRoot), 'utf8');
    assert.match(html, /http-equiv="Content-Security-Policy"/i, `${file} 缺少 CSP`);
    assert.doesNotMatch(html, /<script\b[^>]*>\s*[^<\s]/i, `${file} 含内联脚本`);
    assert.doesNotMatch(html, /\son[a-z]+\s*=/i, `${file} 含内联事件处理器`);
  }
});

test('主数据库只允许加密连接，旧明文键只用于一次性迁移', async () => {
  const databaseSource = await readFile(new URL('js/db.js', sourceRoot), 'utf8');
  assert.doesNotMatch(databaseSource, /encrypted:\s*false|mode:\s*['"]no-encryption/);
  assert.match(databaseSource, /encrypted:\s*true/);

  const settingsSource = await readFile(new URL('js/settings.js', sourceRoot), 'utf8');
  assert.doesNotMatch(settingsSource, /localStorage\.setItem\(['"]hamlog_hamqth_pass/);
});
