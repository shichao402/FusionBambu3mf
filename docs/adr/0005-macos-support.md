# 0005 macOS 支持

## 背景

项目最初只面向 Windows：打包走 NSIS，开发版静默装到 `%LOCALAPPDATA%`，路径拼接按 `\` 写死。要让 macOS 用户也能用，需要判断哪些部分真正与平台相关。

Fusion 桥插件在两端使用同一套 Fusion API，`addins_dir()` 也已经同时尝试 `%APPDATA%\Autodesk` 与 `~/Library/Application Support/Autodesk`，所以桥和 3MF 处理库不需要为平台分叉。差异实际只有四处：路径表示、开发版部署脚本、打包矩阵、分发签名。

## 决策

### 1. 内部统一 POSIX 表示，边界处才转换

所有路径比较、相对化、拆段都在 `desktop/threemf/paths.ts` 里做，内部用 `/` 表示。只有拼装最终绝对路径时才按平台换分隔符。

考虑过的替代方案是全部用 `path.posix` / `path.win32`，但那会引入 Node 依赖，而这段代码要跑在浏览器环境的 Tauri 前端里。自建一层薄封装更贴合现状，且可以通过 `setPlatform` 在测试里切换两套语义。

平台标识不靠 UA 猜测，而是由 Rust 侧 `host_platform` 命令回传一次，前端启动时注入。这样 Windows 用户即使系统区域设置异常也不会走错分支。

### 2. 导出目录以相对路径存储

3MF 里保存的导出目录默认保持相对工程文件的相对路径，而不是绝对路径。这样同一份 3MF 在 Windows 和 macOS 上都能解析，跨机器传递不会失效。

代价是 macOS 上若用户显式选了绝对 POSIX 目录（`/Volumes/...`），该值会被认为合法并直接使用，但拿到 Windows 上会失效。反过来，盘符路径（`D:\`）在 macOS 上判为非法并回退到默认目录 `变体`。这是有意的取舍：宁可回退到可预期位置，也不生成一个打不开的路径。

### 3. macOS 打包用 DMG，本地部署用 .app

最终分发用 `.dmg`，与用户对 macOS 安装包的预期一致。开发版部署跳过 DMG 直接构建 `.app` 并用 `ditto` 复制到 `~/Applications`，因为 DMG 需要挂载镜像，在 CI 之外的无图形环境里容易失败，而且本地迭代也不需要安装流程。

开发版用独立的 `productName`（`FusionBambu3mfDev`）与 `identifier`（`dev.fusionbambu.desktop.dev`），与正式版共存，互不覆盖。

### 4. 签名默认 ad-hoc，公证靠环境变量开启

`tauri.conf.json` 里 `signingIdentity` 设为 `-`，即临时签名。本机构建的包可以直接运行。

分发到其他机器时，未公证的包会被 Gatekeeper 拦成「已损坏」。因此打包流程在检测到 `APPLE_SIGNING_IDENTITY`、`APPLE_ID`、`APPLE_PASSWORD`、`APPLE_TEAM_ID` 四个变量齐全时，会自动用 Developer ID 签名、`notarytool submit` 公证并 `stapler staple`；缺任一变量则回退 ad-hoc，并在 README 里给出 `xattr -dr com.apple.quarantine` 的放行方式。

不选「必须配证书才能打包」，是因为这样会让没有 Apple 开发者账号的贡献者完全无法产出构建。

### 5. 双架构分别构建，而不是 universal 包

`release.yml` 用矩阵分别跑 `macos-14`（arm64）与 `macos-13`（x64）。产物名带架构后缀，避免 `upload-artifact` 与 `download-artifact` 汇总时同名覆盖。

universal 包需要 `lipo` 合并两份二进制，构建时间更长，且第三方 dylib 不一定支持。分别出包对用户更透明，也让 Intel 用户拿到真正的原生构建而不是 Rosetta 转译。

### 6. 产物命名带架构后缀

引入 `CI_TARGET_ARCH` 环境变量。为空时保持原有文件名不变（Windows 与单架构 macOS），非空时在扩展名前插入 `-<target>`。这样既不破坏已有的本地构建习惯，又让多架构产物可以并存。

## 影响

- `scripts/ci.mjs` 新增 `buildArgs`、`bundleDirName`、`archSuffix`、`stampInstallerName`、`signAndNotarize`，Python 解释器候选列表按平台排序。
- `scripts/deploy-dev.mjs` 拆成 `deployWindows` 与 `deployMacos` 两条分支。
- `bridge/bridge_host.py` 的 CORS 从通配符收紧到本机来源白名单，配合只绑定 `127.0.0.1` 的监听。
- 桥内容变更后需要重算 `payload.hash`，否则 `CI_TASK=check` 会失败。

## 未采纳

- 不引入 Linux 支持。脚本遇到其他平台直接报错。
- 不做自动更新。
- 不为平台差异改造 UI 布局。
