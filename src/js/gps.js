/* ============================================================
   gps.js - GPS 定位封装
   使用 navigator.geolocation Web API
   ✅ 不依赖 Google Play Services（国产手机可用）
   ✅ Android WebView 自动弹出位置权限对话框
   返回经纬度，并在设备支持时返回 GPS 海拔
   ============================================================ */

/**
 * 获取当前 GPS 位置
 * 首次调用时 Android WebView 自动弹出位置授权对话框
 * 返回经纬度和海拔（设备无法提供时为 null）
 *
 * @param {Object} [options]
 * @param {HTMLElement} [options.buttonEl] - 触发按钮元素（用于 loading 状态）
 * @returns {Promise<{lat: number, lon: number, alt: number|null}>}
 * @throws {Error} 定位失败或权限被拒绝
 */
export async function getCurrentPosition(options = {}) {
  const { buttonEl } = options;

  // 检查是否支持定位
  if (!navigator.geolocation) {
    throw new Error('您的设备不支持定位功能');
  }

  // 设置按钮 loading 状态
  if (buttonEl) {
    buttonEl.innerHTML = '⏳';
    buttonEl.disabled = true;
  }

  try {
    const position = await new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(
        resolve,
        (err) => {
          switch (err.code) {
            case err.PERMISSION_DENIED:
              reject(new Error('请在系统设置中开启位置权限'));
              break;
            case err.POSITION_UNAVAILABLE:
              reject(new Error('无法获取位置信息，请检查 GPS 是否开启'));
              break;
            case err.TIMEOUT:
              reject(new Error('定位超时，请移至开阔地带重试'));
              break;
            default:
              reject(new Error('获取位置失败：' + (err.message || '未知错误')));
          }
        },
        {
          enableHighAccuracy: true,
          timeout: 20000,
          maximumAge: 60000
        }
      );
    });

    const latitude = Number(position.coords.latitude);
    const longitude = Number(position.coords.longitude);
    const altitude = Number(position.coords.altitude);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      throw new Error('定位结果无效，请重新获取');
    }

    return {
      lat: latitude,
      lon: longitude,
      alt: position.coords.altitude != null && Number.isFinite(altitude) ? altitude : null
    };
  } finally {
    // 恢复按钮状态
    if (buttonEl) {
      buttonEl.innerHTML = '📍';
      buttonEl.disabled = false;
    }
  }
}
