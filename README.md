# HAM Logbook 📡

### 面向中国业余无线电爱好者的 Android 离线通联日志

HAM Logbook 用于记录业余无线电通联（QSO）。核心功能可完全离线使用；联网后可选用 HamQTH 补全对方呼号资料。日志统一使用 UTC，并可导入、导出标准 ADIF 3.1.4 文件，兼容 Logger32、N1MM、Wavelog 等常见日志软件。

> **离线优先 · 数据加密 · 不依赖 GMS · GPL-3.0 开源**

## ✨ 功能

| 类别 | 说明 |
|---|---|
| 📡 离线通联日志 | 创建、编辑、搜索和管理 QSO；日期与时间统一使用 UTC。 |
| 🔍 呼号资料 | 可选配置 HamQTH，一键补全对方姓名、QTH 和网格坐标；未配置账号时不影响离线记录。 |
| 📻 频段与中继 | 根据中国大陆 A/B/C 类操作证类别显示可用频段；管理中继台收发频率与 CTCSS/DCS 亚音。 |
| 🗂️ 历史复用 | 输入呼号后可查询既往通联资料，并带入姓名、设备、天线、功率、地址等字段。 |
| 📥📤 ADIF | 导入、导出和系统分享 ADIF 3.1.4；导出可选文件夹，支持每日自动滚动备份。 |
| 🔐 数据安全 | QSO 数据库使用 SQLCipher 加密；HamQTH 凭据和 QSO 草稿使用 Android Keystore 保护。 |
| 📍 定位与网格 | 使用 Android WebView 定位能力获取位置、海拔和 Maidenhead 网格，不依赖 Google Play 服务。 |
| ◐ 外观与启动页 | 支持白昼/黑夜主题及多种原生启动页风格。 |

## 🔒 隐私与数据说明

- 所有 QSO 数据保存在应用私有空间，不上传至本项目服务器。
- ADIF 是开放、未加密的交换格式；请导出至可信的私人目录。
- 导出 ADIF 默认不含精确经纬度，但保留网格坐标；如确有需要可在设置中主动开启。
- 个人信息备份可使用口令加密，包含中继台、台站呼号、操作证类别、默认 QTH、HamQTH 用户名和设备预设；不包含 QSO 日志和 HamQTH 密码。
- Android 系统自动备份已关闭。卸载应用、清除应用数据或设备损坏均可能造成日志丢失，请在升级、换机前导出 ADIF 和个人信息备份。

## 📱 使用要点

### HamQTH 呼号查询

1. 在 [HamQTH](https://www.hamqth.com/) 注册账号。
2. 在应用中进入 **设置 → 呼号查询与数据管理**，填写用户名和密码。
3. 回到新建 QSO 页面，输入呼号并点击查询按钮。

HamQTH 密码仅存放在 Android Keystore 中，不会写入个人信息备份。

### ADIF 导入、导出与备份

- 在 **设置 → 呼号查询与数据管理** 中选择 ADIF 导出文件夹；系统会保存该文件夹授权。
- 可导出 ADIF、分享日志，或导入 `.adi` / `.adif` 文件。
- 自动备份每天最多生成一份，滚动保留最近 7 份。
- 大型 ADIF 采用流式解析、分批写入和整文件事务；导入失败会回滚。本应用限制单个导入文件最大 256 MB、最多 100 万条记录。

### 升级至 v1.1.0

- 请直接覆盖安装，不要先卸载旧版，以保留数据。
- 首次启动时，旧版本的明文日志数据库会原地迁移至 SQLCipher 加密数据库；日志较多时请耐心等待。
- 完成迁移后不建议降级到旧版，因为旧版可能无法读取加密后的数据库。

## 🛠️ 技术栈

- **容器框架**：[Capacitor 8.5](https://capacitorjs.com/)
- **前端**：HTML5、CSS3、Vanilla JavaScript（无框架、无 CDN）
- **数据库**：SQLite / SQLCipher（[`@capacitor-community/sqlite` 8.1](https://github.com/capacitor-community/sqlite)）
- **原生平台**：Android，`minSdk 24`（Android 7.0+）、`compileSdk` / `targetSdk` 36
- **定位**：`navigator.geolocation` Web API

## 🚀 开发与构建

### 环境要求

| 依赖 | 版本 |
|---|---|
| Node.js | 22+ |
| JDK | 17+ |
| Android SDK | Android API 36（并安装相应 Build Tools） |

Android 原生工程已经提交到仓库，首次克隆后**不需要**执行 `npx cap add android`。

```bash
# 安装 JavaScript 依赖
npm ci

# 运行单元测试
npm test

# 将 Web 资源和 Capacitor 配置同步到 Android 工程
npm run sync

# 构建 Debug APK
cd android
./gradlew assembleDebug
```

Debug APK 位于：

```text
android/app/build/outputs/apk/debug/app-debug.apk
```

安装到已开启 USB 调试的设备：

```bash
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
```

### 正式版签名

真实签名材料绝不能提交到 Git。复制 `android/keystore.properties.example` 为 `android/keystore.properties` 后填写本机签名信息，或设置下列环境变量：

```text
HAMLOG_RELEASE_STORE_FILE
HAMLOG_RELEASE_STORE_PASSWORD
HAMLOG_RELEASE_KEY_ALIAS
HAMLOG_RELEASE_KEY_PASSWORD
```

缺少完整签名配置时，Release 构建会主动失败，避免误发布错误签名的安装包。

## 🔒 Android 权限

| 权限 | 用途 | 申请方式 |
|---|---|---|
| `ACCESS_FINE_LOCATION` / `ACCESS_COARSE_LOCATION` | 获取当前位置、海拔和网格坐标 | 需要使用定位时由 Android 授权 |
| `INTERNET` | 可选的 HamQTH 呼号查询 | 安装时静默授予 |

ADIF 导入、导出使用 Android 系统文件选择器及持久文件夹授权，不申请整盘存储权限。

## 📁 项目结构

```text
HAM-LogBook/
├── src/                         # Web 前端资源
│   ├── index.html               # 新建 QSO
│   ├── history.html             # 历史记录与搜索
│   ├── repeater.html            # 中继台管理
│   ├── settings*.html           # 设置、台站资料、数据管理和启动页
│   ├── css/style.css            # 全局样式与主题
│   └── js/
│       ├── app.js               # QSO 表单、保存与草稿
│       ├── db.js                # 加密 SQLite 数据库与迁移
│       ├── adif.js              # ADIF 解析与生成
│       ├── automatic-backup.js  # 每日 ADIF 备份
│       ├── secure-data.js       # Keystore 安全数据桥接
│       └── vendor/              # 本地化 Capacitor 插件模块
├── android/                     # Android 原生工程与自定义插件
├── tests/                       # Node.js 单元测试
├── package.json
└── capacitor.config.json
```

## 🤝 贡献

欢迎提交 Issue 和 Pull Request。请遵循以下约定：

- 保持 Vanilla JavaScript，不引入框架或 CDN。
- 全局样式集中在 `src/css/style.css`。
- `localStorage` 键名使用 `hamlog_` 前缀。
- 不提交真实密钥、签名文件、环境变量、APK、构建产物、用户数据或个人笔记。
- 提交前运行 `npm test`。

## 📄 License

本项目基于 [GNU GPL v3.0](LICENSE) 开源协议发布。

---

**HAM Logbook** — 让每一次通联都被清晰记录。73! 📻
