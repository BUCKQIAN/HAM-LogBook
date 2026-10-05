/* 在严格 CSP 下替代各 HTML 页面的内联初始化脚本。 */
import { initFieldPickers, refreshFieldPickers } from './field-picker.js';

initFieldPickers();

const page = window.location.pathname.split('/').pop() || 'index.html';
const entrypoints = {
  'index.html': './app.js',
  'history.html': './history.js',
  'repeater.html': './repeater.js',
  'settings-data.html': './settings.js',
  'settings-splash.html': './settings.js',
  'settings-station.html': './settings.js'
};

const modulePath = entrypoints[page];
if (modulePath) {
  const run = async () => {
    const module = await import(modulePath);
    await module.initPage();
    refreshFieldPickers();
    document.documentElement.dataset.pageReady = 'true';
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => void run(), { once: true });
  else void run();
}
