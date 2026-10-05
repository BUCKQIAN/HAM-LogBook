/* 可选的浏览器回归：需要 Playwright 和 Chromium；只使用模拟账号与数据库。 */
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const { chromium } = await import(process.env.HAMLOG_PLAYWRIGHT_MODULE || 'playwright');
const root = fileURLToPath(new URL('../src/', import.meta.url));
const output = fileURLToPath(new URL('../dist/v1.2.0-browser-check/', import.meta.url));
await mkdir(output, { recursive: true });
const server = http.createServer(async (request, response) => {
  const requested = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
  const file = path.resolve(root, `.${requested === '/' ? '/index.html' : requested}`);
  if (!file.startsWith(root)) { response.writeHead(403).end(); return; }
  try {
    const content = await readFile(file);
    const type = { '.js': 'text/javascript', '.html': 'text/html', '.css': 'text/css' }[path.extname(file)] || 'application/octet-stream';
    response.writeHead(200, { 'Content-Type': type });
    response.end(content);
  } catch { response.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
let browser;
let activePage;
try {
  browser = await chromium.launch({ headless: true, ...(process.env.HAMLOG_CHROMIUM_EXECUTABLE ? { executablePath: process.env.HAMLOG_CHROMIUM_EXECUTABLE } : {}) });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await context.addInitScript(() => {
    window._dbReady = true;
    const recordNative = event => {
      const events = JSON.parse(sessionStorage.getItem('mock-native-events') || '[]');
      events.push(event);
      sessionStorage.setItem('mock-native-events', JSON.stringify(events));
    };
    const readRepeaters = () => JSON.parse(localStorage.getItem('mock-repeaters'));
    if (!localStorage.getItem('mock-repeaters')) localStorage.setItem('mock-repeaters', JSON.stringify([
      { id: 1, name: '测试中继', rx_frequency: 439.65, tx_frequency: 434.65, tx_tone: 'T88.5', rx_tone: '', location: '原位置', notes: '原备注', created_at: 1 }
    ]));
    window.Capacitor = { isNativePlatform: () => false, Plugins: {
      NativeSplash: {
        setTheme: async value => { recordNative({ type: 'theme', ...value }); },
        setStyle: async value => { recordNative({ type: 'style', ...value }); return { systemThemeApplied: true }; },
        hide: async () => { recordNative({ type: 'ready' }); }
      },
      CapacitorSQLite: {
      createConnection: async () => ({}),
      query: async ({ statement }) => ({ values: /FROM repeaters/i.test(statement)
        ? readRepeaters() : /COUNT\(/i.test(statement) ? [{ count: 0 }] : [] }),
      run: async ({ statement, values }) => {
        const rows = readRepeaters();
        let id;
        const data = { name: values[0], rx_frequency: values[1], tx_frequency: values[2], tx_tone: values[3], rx_tone: values[4], location: values[5], notes: values[6] };
        if (/^UPDATE repeaters SET name=/i.test(statement)) {
          id = Number(values[7]);
          const row = rows.find(item => item.id === id);
          if (!row) throw new Error('模拟数据库未找到待更新中继');
          Object.assign(row, data);
        } else if (/^INSERT INTO repeaters/i.test(statement)) {
          id = Math.max(0, ...rows.map(row => row.id)) + 1;
          rows.push({ id, ...data, created_at: values[7] });
        } else if (/^DELETE FROM repeaters WHERE id/i.test(statement)) {
          id = Number(values[0]);
          const index = rows.findIndex(row => row.id === id);
          if (index >= 0) rows.splice(index, 1);
        } else throw new Error(`模拟数据库不支持此写入：${statement}`);
        localStorage.setItem('mock-repeaters', JSON.stringify(rows));
        const writes = JSON.parse(localStorage.getItem('mock-repeater-writes') || '[]');
        writes.push(statement);
        localStorage.setItem('mock-repeater-writes', JSON.stringify(writes));
        return { changes: { changes: 1, lastId: id } };
      }
    } } };
  });
  const page = await context.newPage();
  activePage = page;
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const go = async url => {
    await page.goto(url);
    await page.waitForFunction(() => document.documentElement.dataset.pageReady === 'true'
      || (document.body.dataset.settingsPage === 'home' && document.querySelector('.bottom-nav') && window.hamlogTheme));
  };
  const choose = async (label, value) => {
    await page.getByRole('button', { name: new RegExp(`^${label}：`) }).click();
    await page.getByRole('dialog').getByRole('button', { name: value, exact: true }).click();
  };
  // 设置主页不滚动；屏幕过矮时只允许导航之间的内容内部滚动。
  for (const viewport of [{ width: 390, height: 844 }, { width: 320, height: 568 }, { width: 844, height: 390 }, { width: 320, height: 320 }]) {
    await page.setViewportSize(viewport);
    await go(`${base}/settings.html`);
    const sizes = await page.evaluate(() => {
      const content = document.querySelector('.content');
      return { root: document.documentElement.clientHeight, scroll: document.documentElement.scrollHeight,
        content: content.clientHeight, contentScroll: content.scrollHeight,
        bottom: content.getBoundingClientRect().bottom, nav: document.querySelector('.bottom-nav').getBoundingClientRect().top };
    });
    assert.equal(sizes.root, sizes.scroll);
    assert.ok(Math.abs(sizes.bottom - sizes.nav) < 1);
    await page.evaluate(() => window.scrollTo(0, 500));
    assert.equal(await page.evaluate(() => scrollY), 0);
    if (viewport.height === 844) assert.equal(sizes.content, sizes.contentScroll);
    else if (sizes.contentScroll > sizes.content) {
      await page.evaluate(() => document.querySelector('.content').scrollTo(0, 10000));
      const box = await page.getByRole('link', { name: 'https://github.com/BUCKQIAN/HAM-LogBook' }).boundingBox();
      assert.ok(box.y + box.height <= sizes.nav);
    }
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await go(`${base}/settings.html`);
  await page.evaluate(async () => { window.hamlogTheme.set('night'); await window.hamlogTheme.syncNative(); });
  assert.equal(await page.locator('html').getAttribute('data-theme'), 'night');
  assert.deepEqual(await page.evaluate(() => JSON.parse(sessionStorage.getItem('mock-native-events')).at(-1)),
    { type: 'theme', theme: 'night', preference: 'night' });
  await page.waitForFunction(() => getComputedStyle(document.body).backgroundColor === 'rgb(36, 33, 31)');
  await page.screenshot({ path: `${output}/settings-home-night.png` });
  await page.evaluate(() => {
    for (const [side, value] of Object.entries({ top: '24px', bottom: '24px', left: '12px', right: '12px' })) {
      document.documentElement.style.setProperty(`--safe-area-inset-${side}`, value);
    }
  });
  const safeLayout = await page.evaluate(() => {
    const content = document.querySelector('.content').getBoundingClientRect();
    const nav = document.querySelector('.bottom-nav').getBoundingClientRect();
    const header = document.querySelector('.top-bar').getBoundingClientRect();
    return { rootScroll: document.documentElement.scrollHeight, height: innerHeight,
      headerHeight: header.height, contentTop: content.top, contentBottom: content.bottom, navTop: nav.top,
      toggleTop: document.querySelector('.theme-toggle').getBoundingClientRect().top,
      linksBottom: Math.max(...[...document.querySelectorAll('.bottom-nav a')].map(link => link.getBoundingClientRect().bottom)) };
  });
  assert.equal(safeLayout.rootScroll, safeLayout.height);
  assert.equal(safeLayout.headerHeight, 86);
  assert.equal(safeLayout.contentTop, safeLayout.headerHeight);
  assert.equal(safeLayout.contentBottom, safeLayout.navTop);
  assert.ok(safeLayout.toggleTop >= 24);
  assert.ok(safeLayout.linksBottom <= safeLayout.height - 24);
  await page.evaluate(() => {
    for (const side of ['top', 'bottom', 'left', 'right']) document.documentElement.style.removeProperty(`--safe-area-inset-${side}`);
  });
  await go(`${base}/settings-splash.html`);
  await page.getByText('方案 D', { exact: true }).click();
  await page.waitForFunction(() => document.getElementById('toast').textContent.includes('方案 D 已保存'));
  assert.equal(await page.evaluate(() => localStorage.getItem('hamlog_splash_style')), 'D');
  await page.evaluate(async () => { window.hamlogTheme.set('day'); await window.hamlogTheme.syncNative(); });
  await go(`${base}/index.html`);
  assert.equal(await page.locator('html').getAttribute('data-theme'), 'day');
  const launchEvents = await page.evaluate(() => JSON.parse(sessionStorage.getItem('mock-native-events')));
  const readyIndex = launchEvents.findLastIndex(event => event.type === 'ready');
  assert.ok(readyIndex > launchEvents.findLastIndex(event => event.type === 'style'));
  assert.ok(readyIndex > launchEvents.findLastIndex(event => event.type === 'theme'));
  assert.equal(launchEvents.filter(event => event.type === 'style').at(-1).style, 'D');
  await go(`${base}/settings-station.html`);
  assert.equal(await page.evaluate(() => document.documentElement.scrollHeight > innerHeight), true);
  await page.locator('#my-rigs-input').fill('FT-60\nIC-705');
  await page.locator('#save-rigs-btn').click();
  await page.locator('#default-rig').fill('FT-60');
  await page.locator('#default-power').fill('5');
  await page.locator('#default-frequency').fill('144.370');
  await page.locator('#save-qso-defaults-btn').click();
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('hamlog_qso_defaults')).frequency), 144.37);
  await page.screenshot({ path: `${output}/station-defaults.png`, fullPage: true });
  await go(`${base}/index.html`);
  await page.locator('#default-frequency-btn').click();
  assert.equal(await page.locator('#frequency').inputValue(), '144.37');
  assert.equal(await page.locator('#band').inputValue(), '2m');
  await page.locator('#default-equipment-btn').click();
  assert.equal(await page.locator('#my-rig').inputValue(), 'FT-60');
  assert.equal(await page.locator('#my-power').inputValue(), '5');
  await page.locator('#rst-sent').fill('55');
  await page.locator('#rst-rcvd').fill('57');
  await page.locator('#excellent-signal-btn').click();
  assert.equal(await page.locator('#rst-sent').inputValue(), '59');
  assert.equal(await page.locator('#rst-rcvd').inputValue(), '59');
  await page.locator('#choose-repeater-btn').click();
  await page.getByRole('dialog').getByRole('button', { name: '测试中继 · 发射 434.65 MHz', exact: true }).click();
  assert.equal(await page.locator('#frequency').inputValue(), '434.65');
  assert.equal(await page.locator('#band').inputValue(), '70cm');
  await page.screenshot({ path: `${output}/qso-filled.png`, fullPage: true });

  // 使用真实导航反复重建页面，原生候选列表是否可用不影响选择。
  for (let i = 0; i < 3; i++) {
    await page.getByRole('link', { name: '中继', exact: false }).click();
    await page.getByRole('button', { name: '选择发射亚音 可不填' }).click();
    await page.getByRole('dialog').getByRole('searchbox').fill('D023');
    await page.getByRole('dialog').getByRole('button', { name: 'D023N', exact: true }).click();
    assert.equal(await page.locator('#repeater-tx-tone').inputValue(), 'D023N');
    await page.getByRole('link', { name: '记录', exact: false }).click();
    await page.getByRole('button', { name: '选择我的设备', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'IC-705', exact: true }).click();
    assert.equal(await page.locator('#my-rig').inputValue(), 'IC-705');
    await choose('模式', 'SSB');
    assert.equal(await page.locator('#mode').inputValue(), 'SSB');
  }

  // 编辑应覆盖原记录，取消不写入；修改后的频率必须出现在主页的中继选择中。
  await go(`${base}/repeater.html`);
  assert.equal(await page.locator('#repeater-cancel-btn').isVisible(), false);
  await page.locator('#repeater-list').getByRole('button', { name: '编辑', exact: true }).click();
  assert.equal(await page.locator('#repeater-form-title').textContent(), '编辑中继台');
  assert.equal(await page.locator('#repeater-name').inputValue(), '测试中继');
  assert.equal(await page.locator('#repeater-notes').inputValue(), '原备注');
  await page.locator('#repeater-name').fill('取消的修改');
  await page.getByRole('button', { name: '取消编辑', exact: true }).click();
  assert.equal(await page.locator('#repeater-name').inputValue(), '');
  assert.equal(await page.evaluate(() => localStorage.getItem('mock-repeater-writes')), null);
  await page.locator('#repeater-list').getByRole('button', { name: '编辑', exact: true }).click();
  await page.locator('#repeater-tx').fill('0');
  await page.getByRole('button', { name: '保存修改', exact: true }).click();
  assert.equal(await page.evaluate(() => localStorage.getItem('mock-repeater-writes')), null);
  assert.equal(await page.locator('#repeater-cancel-btn').isVisible(), true);
  await page.locator('#repeater-name').fill('已修改中继');
  await page.locator('#repeater-rx').fill('439.875');
  await page.locator('#repeater-tx').fill('434.875');
  await page.locator('#repeater-tx-tone').fill('D023N');
  await page.locator('#repeater-rx-tone').fill('T88.5');
  await page.locator('#repeater-location').fill('新位置');
  await page.locator('#repeater-notes').fill('新备注');
  await page.getByRole('button', { name: '保存修改', exact: true }).click();
  await page.waitForFunction(() => document.getElementById('repeater-list').textContent.includes('已修改中继'));
  assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('mock-repeaters'))), [
    { id: 1, name: '已修改中继', rx_frequency: 439.875, tx_frequency: 434.875, tx_tone: 'D023N', rx_tone: 'T88.5', location: '新位置', notes: '新备注', created_at: 1 }
  ]);
  assert.equal(await page.locator('#repeater-cancel-btn').isVisible(), false);
  await page.screenshot({ path: `${output}/repeater-edited.png`, fullPage: true });
  for (const width of [320, 390, 768]) {
    await page.setViewportSize({ width, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${width}px 中继页出现横向溢出`);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('#repeater-list').getByRole('button', { name: '应用', exact: true }).click();
  await page.waitForFunction(() => document.documentElement.dataset.pageReady === 'true' && location.pathname.endsWith('/index.html'));
  assert.equal(await page.locator('#frequency').inputValue(), '439.875');
  await page.locator('#choose-repeater-btn').click();
  await page.getByRole('dialog').getByRole('button', { name: '已修改中继 · 发射 434.875 MHz', exact: true }).click();
  assert.equal(await page.locator('#frequency').inputValue(), '434.875');
  await go(`${base}/repeater.html`);
  await page.locator('#repeater-list').getByRole('button', { name: '编辑', exact: true }).click();
  page.once('dialog', dialog => dialog.accept());
  await page.locator('#repeater-list').getByRole('button', { name: '删除', exact: true }).click();
  await page.waitForFunction(() => document.getElementById('repeater-list').textContent.includes('暂无中继台'));
  assert.equal(await page.locator('#repeater-form-title').textContent(), '添加中继台');
  assert.equal(await page.locator('#repeater-name').inputValue(), '');
  assert.equal(await page.locator('#repeater-cancel-btn').isVisible(), false);
  // 删除当前编辑项后，新建仍须走 INSERT。
  await page.locator('#repeater-name').fill('新建中继');
  await page.locator('#repeater-rx').fill('439.650');
  await page.locator('#repeater-tx').fill('434.650');
  await page.getByRole('button', { name: '添加', exact: true }).click();
  await page.waitForFunction(() => document.getElementById('repeater-list').textContent.includes('新建中继'));
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('mock-repeater-writes')).map(sql => sql.split(' ')[0]).join(',')), 'UPDATE,DELETE,INSERT');
  await go(`${base}/index.html`);

  // 浏览器返回缓存页面时，设备列表必须反映在设置页保存的最新值。
  await go(`${base}/settings-station.html`);
  await page.locator('#my-rigs-input').fill('新设备');
  await page.locator('#save-rigs-btn').click();
  await page.goBack();
  await page.getByRole('button', { name: '选择我的设备', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: '新设备', exact: true }).click();
  assert.equal(await page.locator('#my-rig').inputValue(), '新设备');
  await page.getByRole('button', { name: '选择我的设备', exact: true }).click();
  await page.keyboard.press('Escape');
  assert.equal(await page.getByRole('dialog').count(), 0);

  let hamLogins = 0;
  let expireFirst = true;
  let releaseSlow;
  const slow = new Promise(resolve => { releaseSlow = resolve; });
  await page.route('https://www.hamqth.com/xml.php**', async route => {
    const url = new URL(route.request().url());
    let xml;
    if (url.searchParams.has('u')) { hamLogins++; xml = '<session><session_id>mock-session</session_id></session>'; }
    else if (expireFirst) { expireFirst = false; xml = '<session><error>Session does not exist or expired</error></session>'; }
    else {
      if (url.searchParams.get('callsign') === 'SLOW') await slow;
      xml = '<search><callsign>BH4TEST</callsign><nick>测试姓名</nick><qth>测试城市</qth><grid>PM01ab</grid><latitude>999</latitude></search>';
    }
    await route.fulfill({ contentType: 'application/xml', headers: { 'Access-Control-Allow-Origin': '*' }, body: `<HamQTH xmlns="https://www.hamqth.com">${xml}</HamQTH>` });
  });
  await go(`${base}/settings-data.html`);
  await page.locator('#hamqth-user').fill('mock-user');
  await page.locator('#hamqth-pass').fill('mock-password');
  await page.locator('#save-account-btn').click();
  await page.locator('#test-account-btn').click();
  await page.waitForFunction(() => document.getElementById('toast').textContent.includes('验证成功'));
  await go(`${base}/index.html`);
  await page.locator('#callsign').fill('BH4TEST');
  await page.locator('#lookup-btn').click();
  await page.waitForFunction(() => document.getElementById('op-name').value === '测试姓名');
  assert.equal(hamLogins, 2);
  assert.equal(await page.locator('#op-locator').inputValue(), 'PM01ab');
  await page.locator('#callsign').fill('SLOW');
  await page.locator('#lookup-btn').click();
  await page.locator('#callsign').fill('OTHER');
  await page.locator('#op-name').fill('当前资料');
  releaseSlow();
  await page.waitForFunction(() => !document.getElementById('lookup-btn').disabled);
  assert.equal(await page.locator('#op-name').inputValue(), '当前资料');

  let qrzLogins = 0;
  let qrzQueries = 0;
  await page.route('https://xmldata.qrz.com/xml/current/**', async route => {
    const req = route.request();
    assert.equal(new URL(req.url()).searchParams.has('password'), false);
    let xml;
    if (req.method() === 'POST') {
      qrzLogins++;
      assert.equal(new URLSearchParams(req.postData()).get('password'), 'mock-qrz-password');
      xml = '<Session><Key>mock-key</Key><SubExp>non-subscriber</SubExp></Session>';
    } else {
      qrzQueries++;
      xml = qrzQueries === 1
        ? '<Session><Error>Session Timeout</Error></Session>'
        : '<Callsign><call>BH4TEST</call><fname>有限姓名</fname><addr2>有限城市</addr2></Callsign><Session><Key>new-key</Key><Message>Limited data</Message></Session>';
    }
    await route.fulfill({ contentType: 'application/xml', headers: { 'Access-Control-Allow-Origin': '*' }, body: `<QRZDatabase xmlns="http://xmldata.qrz.com">${xml}</QRZDatabase>` });
  });
  await go(`${base}/settings-data.html`);
  await choose('查询源', 'QRZ（普通账号可尝试有限查询）');
  await page.locator('#qrz-user').fill('mock-qrz-user');
  await page.locator('#qrz-pass').fill('mock-qrz-password');
  await page.locator('#save-account-btn').click();
  await go(`${base}/index.html`);
  await page.locator('#callsign').fill('BH4TEST');
  await page.locator('#lookup-btn').click();
  await page.waitForFunction(() => document.getElementById('op-name').value === '有限姓名');
  assert.equal(qrzLogins, 2);
  assert.equal(qrzQueries, 2);
  assert.equal(await page.locator('#op-qth').inputValue(), '有限城市');
  await page.locator('#rst-sent').fill('55');
  await page.locator('#rst-rcvd').fill('57');
  await page.locator('#excellent-signal-btn').click();
  await page.waitForFunction(() => {
    const draft = JSON.parse(sessionStorage.getItem('hamlog_session_qso_draft') || 'null');
    return draft?.fields['rst-sent'] === '59' && draft?.fields['rst-rcvd'] === '59';
  });
  await page.locator('#frequency').fill('144.370');
  await choose('频段', '选择频段');
  await page.locator('#save-btn').click();
  assert.equal(await page.evaluate(() => document.activeElement.getAttribute('aria-label')), '频段：选择频段');
  // 两个默认快捷按钮不应在设置缺失时清除用户手填内容。
  await page.evaluate(() => localStorage.removeItem('hamlog_qso_defaults'));
  await page.locator('#my-rig').fill('手填设备');
  await page.locator('#default-equipment-btn').click();
  assert.equal(await page.locator('#my-rig').inputValue(), '手填设备');
  for (const width of [320, 390, 768]) {
    await page.setViewportSize({ width, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${width}px 出现横向溢出`);
    assert.equal(await page.evaluate(() => {
      const row = document.querySelector('.signal-shortcuts').getBoundingClientRect();
      const buttons = [...document.querySelectorAll('.signal-shortcuts button')].map(button => button.getBoundingClientRect());
      const rst = document.getElementById('rst-sent').getBoundingClientRect();
      const equipment = document.getElementById('default-equipment-btn').getBoundingClientRect();
      return row.top >= rst.bottom && Math.abs(row.width - equipment.width) < 1 && buttons.every(button => Math.abs(button.y - buttons[0].y) < 1 && Math.abs(button.width - buttons[0].width) < 1);
    }), true, `${width}px 三个信号快捷按钮应在 RST 下方等宽占满一行`);
    if (width !== 768) await page.locator('.card').nth(1).screenshot({ path: `${output}/signal-shortcuts-${width}.png` });
  }
  assert.deepEqual(errors, []);
  console.log('浏览器回归通过：设置主页固定布局与小屏可访问性、主题/启动样式同步和就绪顺序、默认值和优秀信号、中继编辑与应用、三轮跨页选择、HamQTH/QRZ 模拟查询、320/390/768px 布局。');
} catch (error) {
  if (activePage) {
    console.error(await activePage.evaluate(() => ({
      page: location.pathname, toast: document.getElementById('toast')?.textContent
    })));
    await activePage.screenshot({ path: `${output}/failure.png`, fullPage: true });
  }
  throw error;
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
