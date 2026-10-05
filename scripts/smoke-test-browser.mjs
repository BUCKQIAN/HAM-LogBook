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
    window.Capacitor = { isNativePlatform: () => false, Plugins: { CapacitorSQLite: {
      createConnection: async () => ({}),
      query: async ({ statement }) => ({ values: /FROM repeaters/i.test(statement)
        ? [{ id: 1, name: '测试中继', rx_frequency: 439.65, tx_frequency: 434.65, tx_tone: 'T88.5', rx_tone: '' }]
        : /COUNT\(/i.test(statement) ? [{ count: 0 }] : [] })
    } } };
  });
  const page = await context.newPage();
  activePage = page;
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const go = async url => {
    await page.goto(url);
    await page.waitForFunction(() => document.documentElement.dataset.pageReady === 'true');
  };
  const choose = async (label, value) => {
    await page.getByRole('button', { name: new RegExp(`^${label}：`) }).click();
    await page.getByRole('dialog').getByRole('button', { name: value, exact: true }).click();
  };
  await go(`${base}/settings-station.html`);
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
  }
  assert.deepEqual(errors, []);
  console.log('浏览器回归通过：默认值、中继收发频率、三轮跨页选择、返回后预设刷新、HamQTH/QRZ 登录重试和填充、旧查询结果丢弃、320/390/768px 布局。');
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
