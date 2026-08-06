# HAM Logbook 📡 业余无线电通联日志 - Android
### 一个免费、开源、面对新火腿的 Android 业余无线电通联日志软件

面向中国业余无线电爱好者（HAM）的 **Android 离线日志软件**。记录每一次通联（QSO），支持野外无网络环境使用；联网后可通过 HamQTH 一键补全对方呼号资料。日志时间统一使用 **UTC**，可导出标准 **ADIF 3.1.4** 格式，兼容 Logger32、N1MM、Wavelog 等主流日志系统。

> **离线优先 · 隐私安全 · 零依赖 GMS · 开源免费**

## ✨ 功能特性

| 类别 | 说明 |
|------|------|
| 📡 **离线优先** | 所有核心功能无需网络即可使用，野外通联无障碍 |
| 🔍 **呼号查询** | HamQTH 免费 API，一键补全对方姓名、位置、网格坐标 |
| 📍 **无 GMS 定位** | 使用 Android WebView 系统定位，**不依赖 Google Play 服务**（国产手机可用） |
| ⏱ **UTC 日志** | 打开/关闭时间默认 UTC 标准时，一键刷新，符合国际日志规范 |
| 📶 **中继台管理** | 手动录入常用中继台（收发频率 + 收发亚音），一键应用到通联表单 |
| 📤 **ADIF 导入/导出** | 标准 ADIF 3.1.4 格式，兼容 Logger32 / N1MM / Wavelog |
| 💾 **SQLite 存储** | 所有数据存于应用私有空间，不上传任何服务器 |
| ◐ **昼夜主题** | 纸张与墨色风格，支持白昼 / 黑夜模式切换 |
| 🖼️ **原生启动页** | 五种 Android 原生启动风格，先于 WebView 与数据库显示 |

## 🖥️ 环境要求

- **Android 8.0+**（API 26 及以上；构建时 `minSdk 22`）
- 无需 Google Play 服务
- 支持国产 Android 手机 / 平板

## 🛠️ 技术栈

- **框架**：[Capacitor 5.x](https://capacitorjs.com/)（WebView 容器）
- **前端**：原生 HTML5 + CSS3 + Vanilla JavaScript（**零框架、零 CDN**，野外离线不失效）
- **数据库**：SQLite（[@capacitor-community/sqlite](https://github.com/capacitor-community/sqlite) 5.x）
- **定位**：`navigator.geolocation` Web API（免 GMS）
- **主题**：CSS 变量 + `data-theme`，昼夜双模式

## 📦 快速开始

### 环境准备

| 依赖 | 版本要求 |
|------|---------|
| Node.js | 18+ |
| JDK | 17+（本仓库实测 JDK 21 可用） |
| Android SDK | `platforms;android-33` + `build-tools;33.0.0`（无需 Android Studio GUI） |

### 安装与打包

```bash
# 1. 安装依赖
npm install

# 2. 首次生成 Android 原生工程
npx cap add android

# 3. 同步 Web 资源到 Android 工程
npx cap sync

# 4. 打包 Debug APK
cd android
./gradlew assembleDebug

# APK 输出路径：
# android/app/build/outputs/apk/debug/app-debug.apk
```

> 💡 国内网络建议在 `android/gradle/wrapper/gradle-wrapper.properties` 中
> 将 `distributionUrl` 指向腾讯云镜像（本仓库已配置）：
> `https://mirrors.cloud.tencent.com/gradle/gradle-8.5-bin.zip`

### 安装到手机

```bash
# USB 连接手机（开启开发者模式 + USB 调试）
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
```

或者直接复制 APK 到手机点击安装。

## 📱 使用说明

### HamQTH 呼号查询配置

1. 访问 [hamqth.com](https://www.hamqth.com/) 免费注册账号
2. App 内进入 **设置 → 呼号查询源（HamQTH）**，填入用户名和密码
3. 回到首页，输入呼号后点击 🔍 按钮即可查询

> 未配置 HamQTH 账号不影响任何离线功能，仅停用联网查询。

### 时间规范

- 日志日期与时间统一使用 **UTC**（北京时间 -8 小时）
- 首页一键「⏱ 更新当前 UTC 时间」，无需手动换算

### ADIF 导出

- 设置 → 数据管理 → 导出 ADIF
- 文件导出至应用可访问的文档目录，可直接分享给 Logger32 / N1MM / Wavelog

## 🔒 权限说明

| 权限 | 用途 | 申请时机 |
|------|------|---------|
| `ACCESS_FINE_LOCATION` / `COARSE` | 获取当前位置、海拔、网格坐标 | **首次启动时**统一申请 |
| `READ/WRITE_EXTERNAL_STORAGE` | ADIF 文件导出/导入（Android 10- 场景） | **首次启动时**统一申请 |
| `INTERNET` | HamQTH 呼号查询 | 静默授予 |

## 📁 项目结构

```
ham-logbook/
├── package.json              # 依赖与脚本（type: module）
├── capacitor.config.json     # Capacitor 配置（CapacitorHttp 已开启）
├── src/                      # Web 前端（Capacitor webDir）
│   ├── index.html            # 新建 QSO（首页）
│   ├── history.html          # 历史记录 / 搜索 / 统计
│   ├── repeater.html         # 中继台管理
│   ├── settings.html         # 设置 / 导入导出 / 关于
│   ├── css/style.css         # 全局样式（深/浅双主题，纯手写）
│   └── js/
│       ├── app.js            # 首页逻辑（表单 / 验证 / 保存）
│       ├── db.js             # SQLite 封装（单例）
│       ├── adif.js           # ADIF 3.1.4 解析 / 生成
│       ├── hamqth.js         # HamQTH API（Session 管理 / 超时重试）
│       ├── gps.js            # Web 定位封装
│       ├── locator.js        # Maidenhead 网格计算
│       ├── radio.js          # 频段识别 / 亚音校验
│       ├── theme.js          # 昼夜主题管理
│       ├── splash.js         # 启动页风格设置
│       └── vendor/           # Capacitor 插件本地化（import map 兼容）
└── android/                  # Android 原生工程（Capacitor 生成）
    └── app/src/main/java/... # MainActivity + NativeSplash 插件
```

## 🤝 贡献

欢迎提交 Issue 与 Pull Request。请保持：

- 纯 Vanilla JS，**不引入框架与 CDN**
- 所有样式写在 `src/css/style.css`
- `localStorage` key 统一使用 `hamlog_` 前缀
- 代码注释使用中文

## 📄 License

本项目基于 **GNU GPL v3.0** 开源协议发布，详见 [LICENSE](LICENSE)。

---

**HAM Logbook** — 让每一次通联都被清晰记录。73! 📻
