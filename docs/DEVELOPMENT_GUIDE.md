# HAM Logbook 开发与发布指南

本次将 v1.0.0、v1.1.0 从原有 Git 标签重新构建，统一使用独立正式签名密钥。应用版本号仍为 1.0.0 / 1.1.0，内部版本号仍为 10 / 11，安装包文件名增加 `-release`。原有标签和旧 APK 保留，方便追溯。

## 安装与升级

原先发布的两个版本使用不同的 Debug 签名，均不能被新正式签名包覆盖安装。已装旧包的用户需要：

1. 导出 ADIF 到应用之外；如支持个人信息备份，也一并导出并保存口令。
2. 确认备份文件可读取，再卸载旧包。
3. 安装新包，导入 ADIF，恢复或重新填写台站资料及 HamQTH 密码。

两个重打包版使用同一证书，包名一致，v1.1.0 的 versionCode 大于 v1.0.0，因此具备覆盖升级的签名和版本条件。数据库迁移及设备兼容性仍需要真机测试；测试通过前，不把它当作保留数据的承诺。v1.1.0 使用加密数据库，不建议降级回 v1.0.0。

首次使用者优先安装 v1.1.0；重打包 v1.0.0 用于历史留档和升级测试，其功能与数据保护方式仍保持原样。

Android 对更新签名的要求见 [Android 官方签名说明](https://developer.android.com/studio/publish/app-signing)。

## 密钥保存在哪里

本机的正式签名目录为项目同级的 `DeveloperTools/ham-logbook-signing/`：

| 文件 | 用途 | 是否可以公开 |
|---|---|---|
| `ham-logbook-release.jks` | 正式签名私钥 | 否 |
| `keystore.properties` | 私钥路径、别名与口令 | 否 |
| `ham-logbook-release-certificate.pem` | 核验签名身份的公开证书 | 是 |
| `README.md` | 本机密钥管理说明 | 不含口令 |

证书 SHA-256：

```text
33:26:BC:A1:68:A3:44:78:B1:EA:21:52:DD:C0:31:62:D1:DB:76:17:F5:B2:6C:B2:F9:63:B0:FD:1C:94:0E:07
```

把私钥和口令另存一份到独立介质或密码管理器。GitHub 的源码、公开证书和 APK 都不能恢复遗失的私钥。以后发布始终使用这把密钥，不要重新生成或覆盖它。

## 重新构建两个历史版本

需要 Python 3、Node.js 22+、JDK 17（v1.0.0）与 JDK 21（v1.1.0），以及 Android SDK 33 / 36、Build Tools 35.0.0。本机使用 DeveloperTools 中的 SDK、Gradle 缓存与 npm 缓存；JDK 21 可放在 `DeveloperTools/jdks/` 中，脚本会自动识别，也可通过 `--jdk-21` 指定 `Contents/Home` 路径。

在项目根目录运行：

```bash
python3 scripts/rebuild-releases.py
```

脚本会分别导出两个 Git 标签，在 `dist/.rebuild-work/` 中构建，按历史锁文件安装依赖、同步 Capacitor、构建 Release、对齐 APK、用正式密钥签名并核验。口令只传给需要它的子进程，不输出、不写入源码归档。脚本拒绝覆盖已有的新 APK；再次构建可以指定新的输出目录：

```bash
python3 scripts/rebuild-releases.py --output dist/formal-rebuild-another-run
```

只构建一个版本：

```bash
python3 scripts/rebuild-releases.py --ref v1.1.0 --output dist/formal-rebuild-another-run
```

默认输出目录是 `dist/formal-rebuild-当天日期/`，包含：

- `HAM-LogBook-v1.0.0-release.apk`、`HAM-LogBook-v1.1.0-release.apk`。
- 对应源码 ZIP，来自原始标签，不含依赖、构建产物或私钥。
- `BUILD-v1.0.0.json`、`BUILD-v1.1.0.json`：源码提交号、实际 APK 版本、证书、校验值和检查结果。
- 公开证书、构建脚本副本和 `SHA256SUMS`。

本次 v1.1.0 构建遇到 Google Maven 的 Java TLS 握手失败。已从 Google 官方仓库取得并核验 `play-sdk-proto:31.13.0` 的原始 JAR / POM，放在 `dist/.rebuild-maven-fallback/`。脚本会自动识别这份本地副本，只用于 v1.1.0 的这个构建依赖，并再次检查 SHA-256。构建记录会注明使用了本地依赖源；应用源码保持不变，正常的 Release 检查照常执行。

已有依赖全部缓存时，也可加 `--gradle-offline`。换电脑需要重新准备构建环境；本地备用依赖目录和缓存没有提交到 Git。

在输出目录运行 `shasum -a 256 -c SHA256SUMS` 可以核对文件。构建失败时，日志位于对应的 `dist/.rebuild-work/版本-提交号/build.log`。

这个脚本专门用于两个历史版本。日常新版本仍在当前源码中运行 `npm test`、`npm run sync`，然后在 `android/` 执行 `./gradlew assembleRelease`。配置本机 SDK 路径和被 Git 忽略的签名配置后即可使用；调试版使用单独的 `.debug` 包名。

本机当前源码的日常构建示例（JDK 21 放在外置盘，不更改系统默认 Java）：

```bash
export JAVA_HOME="/Volumes/APFS-EAGET_SSD_1TB_Media/DeveloperTools/jdks/jdk-21.0.12.1+1/Contents/Home"
npm test
npm run sync
cd android
./gradlew assembleRelease
```

本机的 `android/local.properties` 已指向外置 SDK，`android/keystore.properties` 通过符号链接读取外部签名配置；这两个本机文件均被 Git 忽略。换电脑时需要重新配置路径并安全恢复同一把私钥。

## 用 Git 管理长期项目

| 名词 | 在这个项目中的意思 |
|---|---|
| 仓库 | 项目的源码和修改历史；GitHub 上有远程副本 |
| 分支 | 某项修改的工作路线，例如 `codex/release-signing-rebuild` |
| 提交（commit） | 一次有说明的源码存档；修改文件不等于已经提交 |
| 标签（tag） | 指向一次源码提交的固定版本标记，例如 `v1.1.0` |
| Release | GitHub 上面向用户的发布说明及 APK 等附件 |
| Worktree | 同一仓库的独立工作目录，适合同时维护多项修改 |

当前只需要 `main` 加短期分支：每次修改建一个分支，完成测试和检查后合并到 main，正式发布时建立标签。暂时无需复杂的多层分支流程。

这次只重打包历史版本，保留 `v1.0.0` / `v1.1.0` 标签原来的指向。下一次修改功能或修复问题时，更新所有版本字段，使用新版本号，例如 `1.1.1` / versionCode `12`，再建立新标签。

发布前需要检查：单元测试、Release 构建、APK 签名、版本号；在真机上测试首次安装、QSO 保存、ADIF 导入导出和覆盖升级后数据是否完整。发布附件同时提供校验值与公开证书；历史版本重打包必须说明签名更换和安装步骤。

## 怎样向 Codex 提需求

Codex 可以读取并修改这个项目、运行测试和构建，也可以帮助解释代码及检查修改。较大改动可以先用 Plan 模式梳理步骤，再实施；完成后在差异视图中检查修改。官方说明见 [OpenAI：Codex 的开发、验证与审查流程](https://developers.openai.com/blog/run-long-horizon-tasks-with-codex)。

你可以直接这样说：

- “先解释这个功能现在怎么工作，暂时不要改代码。”
- “帮我修复这个问题，建独立分支，完成测试后说明改了哪里。”
- “我不确定方案，先给我两个选择并说明影响。”
- “检查当前修改是否会丢失用户日志，告诉我哪些地方还没验证。”
- “整理为 Git 提交并推送分支，创建 PR 供我检查。”
- “准备发布新版本，先给我 APK、校验结果和发布说明，确认后再上传。”

优先讲清楚你想达到的效果、遇到的现象和需要保留的数据。涉及手机实际操作时，用真机结果补充验证；源码检查与成功构建不能替代实际运行测试。
