import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../src/js/theme.js', import.meta.url), 'utf8');
const themeKey = 'hamlog_theme';
const flushAsync = () => new Promise(resolve => setImmediate(resolve));

function eventTarget(properties = {}) {
  const listeners = new Map();
  return {
    ...properties,
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(listener);
    },
    dispatch(type, event = {}) {
      for (const listener of listeners.get(type) || []) listener(event);
    }
  };
}

function createThemePage({ storedTheme, systemDark = false, nativeSetTheme = async () => {} } = {}) {
  const storage = new Map(storedTheme === undefined ? [] : [[themeKey, storedTheme]]);
  const writes = [];
  const nativeCalls = [];
  const warnings = [];
  const toggle = eventTarget({
    textContent: '',
    attributes: {},
    setAttribute(name, value) { this.attributes[name] = value; }
  });
  const label = { textContent: '' };
  const media = eventTarget({ matches: systemDark });
  const document = eventTarget({
    documentElement: { dataset: {}, style: {} },
    visibilityState: 'visible',
    querySelectorAll(selector) {
      if (selector === '[data-theme-toggle]') return [toggle];
      if (selector === '[data-theme-label]') return [label];
      return [];
    }
  });
  const window = eventTarget({
    matchMedia: () => media,
    Capacitor: {
      Plugins: {
        NativeSplash: {
          setTheme(options) {
            const call = { ...options };
            nativeCalls.push(call);
            return nativeSetTheme(call);
          }
        }
      }
    }
  });
  const context = vm.createContext({
    window,
    document,
    localStorage: {
      getItem: key => storage.get(key) ?? null,
      setItem(key, value) {
        storage.set(key, String(value));
        writes.push({ key, value: String(value) });
      }
    },
    console: { warn: (...args) => warnings.push(args) }
  });
  vm.runInContext(source, context, { filename: 'theme.js' });
  document.dispatch('DOMContentLoaded');
  return { window, document, media, storage, writes, nativeCalls, warnings, toggle, label };
}

test('手动昼夜设置优先于系统外观，并同步按钮和原生启动页', async () => {
  for (const [storedTheme, systemDark] of [['day', true], ['night', false]]) {
    const page = createThemePage({ storedTheme, systemDark });
    assert.equal(page.window.hamlogTheme.get(), storedTheme);
    assert.equal(page.document.documentElement.style.colorScheme, storedTheme === 'night' ? 'dark' : 'light');
    assert.equal(page.label.textContent, storedTheme === 'night' ? '黑夜模式' : '白昼模式');
    assert.equal(page.toggle.attributes['aria-label'], storedTheme === 'night' ? '切换到白昼模式' : '切换到黑夜模式');
    page.media.matches = !systemDark;
    page.media.dispatch('change');
    assert.equal(page.window.hamlogTheme.get(), storedTheme);
    assert.deepEqual(page.writes, []);
    await flushAsync();
    assert.deepEqual(page.nativeCalls, [{ theme: storedTheme, preference: storedTheme }]);
  }
});

test('未选择有效手动主题时跟随系统变化，不把系统结果保存为手动偏好', async () => {
  for (const storedTheme of [undefined, 'invalid']) {
    const page = createThemePage({ storedTheme, systemDark: true });
    assert.equal(page.window.hamlogTheme.get(), 'night');
    page.media.matches = false;
    page.media.dispatch('change');
    assert.equal(page.window.hamlogTheme.get(), 'day');
    assert.equal(page.document.documentElement.style.colorScheme, 'light');
    assert.equal(page.storage.get(themeKey), storedTheme);
    assert.deepEqual(page.writes, []);
    await flushAsync();
    assert.deepEqual(page.nativeCalls, [
      { theme: 'night', preference: 'system' },
      { theme: 'day', preference: 'system' }
    ]);
  }
});

test('快速切换会串行等待原生同步，最终启动页偏好与最后一次选择一致', async () => {
  const pending = [];
  let nativeTheme;
  const page = createThemePage({
    nativeSetTheme: options => new Promise(resolve => {
      pending.push(() => { nativeTheme = options.theme; resolve(); });
    })
  });
  page.window.hamlogTheme.set('night');
  page.window.hamlogTheme.set('day');
  page.window.hamlogTheme.set('night');
  assert.equal(page.window.hamlogTheme.get(), 'night');
  assert.equal(page.storage.get(themeKey), 'night');
  await flushAsync();
  assert.deepEqual(page.nativeCalls, [{ theme: 'day', preference: 'system' }]);
  for (const expectedCount of [2, 3, 4]) {
    pending.shift()();
    await flushAsync();
    assert.equal(page.nativeCalls.length, expectedCount);
    assert.equal(pending.length, 1, '前一次完成后才开始下一次原生写入');
  }
  pending.shift()();
  await flushAsync();
  assert.deepEqual(page.nativeCalls, [
    { theme: 'day', preference: 'system' },
    { theme: 'night', preference: 'night' },
    { theme: 'day', preference: 'day' },
    { theme: 'night', preference: 'night' }
  ]);
  assert.equal(nativeTheme, 'night');
  assert.equal(pending.length, 0);
});

test('原生同步失败不阻断下一次主题选择或按钮操作', async () => {
  let attempts = 0;
  let nativeTheme;
  const page = createThemePage({
    nativeSetTheme: async options => {
      if (++attempts === 1) throw new Error('模拟原生写入失败');
      nativeTheme = options.theme;
    }
  });
  page.toggle.dispatch('click');
  assert.equal(page.window.hamlogTheme.get(), 'night');
  assert.equal(page.storage.get(themeKey), 'night');
  await flushAsync();
  assert.equal(page.warnings.length, 1);
  assert.equal(nativeTheme, 'night');
  page.toggle.dispatch('click');
  await flushAsync();
  assert.equal(page.window.hamlogTheme.get(), 'day');
  assert.equal(page.storage.get(themeKey), 'day');
  assert.equal(nativeTheme, 'day');
});

test('缓存页面 pageshow 重新读取其他页面保存的主题并同步原生外观', async () => {
  const page = createThemePage({ storedTheme: 'night', systemDark: true });
  await flushAsync();
  page.storage.set(themeKey, 'day');
  page.window.dispatch('pageshow', { persisted: true });
  assert.equal(page.window.hamlogTheme.get(), 'day');
  assert.equal(page.label.textContent, '白昼模式');
  assert.equal(page.document.documentElement.style.colorScheme, 'light');
  await flushAsync();
  assert.deepEqual(page.nativeCalls.at(-1), { theme: 'day', preference: 'day' });
  assert.deepEqual(page.writes, []);
});

test('页面重新可见时恢复最新外观，隐藏事件不触发额外同步', async () => {
  const page = createThemePage({ storedTheme: 'day' });
  await flushAsync();
  page.storage.set(themeKey, 'night');
  page.document.visibilityState = 'hidden';
  page.document.dispatch('visibilitychange');
  await flushAsync();
  assert.equal(page.nativeCalls.length, 1);
  assert.equal(page.window.hamlogTheme.get(), 'day');
  page.document.visibilityState = 'visible';
  page.document.dispatch('visibilitychange');
  await flushAsync();
  assert.equal(page.window.hamlogTheme.get(), 'night');
  assert.deepEqual(page.nativeCalls.at(-1), { theme: 'night', preference: 'night' });
});
