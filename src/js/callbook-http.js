/* Android 直接通过 CapacitorHttp 请求，浏览器预览使用 fetch。 */
export async function requestCallbookXml(url, { service, method = 'GET', data } = {}) {
  const timeout = 10000;
  const nativeHttp = window.Capacitor?.isNativePlatform?.() && window.Capacitor?.Plugins?.CapacitorHttp;
  try {
    if (nativeHttp) {
      const response = await nativeHttp.request({
        url, method, data,
        headers: data ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {},
        responseType: 'text', connectTimeout: timeout, readTimeout: timeout,
        disableRedirects: true
      });
      if (response.status < 200 || response.status >= 300) throw new Error(`${service} 服务返回 HTTP ${response.status}`);
      return String(response.data);
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const response = await fetch(url, {
        method, body: data, headers: data ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {},
        signal: controller.signal, cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'error'
      });
      if (!response.ok) throw new Error(`${service} 服务返回 HTTP ${response.status}`);
      return await response.text();
    } finally { clearTimeout(timer); }
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('查询超时，请检查网络连接');
    if (/服务返回 HTTP/.test(error.message)) throw error;
    // 原生错误可能携带含凭据的 URL，不能直接显示或记录。
    throw new Error(`${service} 网络请求失败，请检查网络后重试`);
  }
}
