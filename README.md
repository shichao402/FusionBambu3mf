# FusionBambu3mf

Fusion 薄桥加上 Tauri 桌面程序。Fusion 管几何和标星参数，一份 3MF 管打印配方和尺寸变体。

支持平台：Windows 与 macOS（Apple Silicon 与 Intel）。

## 文档

- [架构](docs/architecture/overview.md)
- [桥 API](docs/architecture/bridge-api.md)
- [决策](docs/adr/0001-thin-bridge.md)
- [macOS 支持决策](docs/adr/0005-macos-support.md)
- [路线](docs/roadmap/mvp.md)
- [3MF 探测](docs/research/3mf-hierarchy.md)

## 技术栈

| 层 | 选型 |
| --- | --- |
| 桌面壳 | Tauri 2.x（CLI 2.12.x、API 2.12.x、Rust edition 2021） |
| Rust 依赖 | `tauri 2`、`rfd 0.15`、`serde`、`serde_json`、`sha2 0.10` |
| 前端 | React 18.3、TypeScript 5.8 |
| 构建 | Vite 6.3、`@vitejs/plugin-react` 4.7，开发端口 1420 |
| 样式 | Tailwind CSS 4.3、设计 token |
| 组件 | Radix Dialog / Slot、CVA、clsx、tailwind-merge、lucide-react |
| 3MF 处理 | fflate 0.8、@xmldom/xmldom 0.9（`desktop/threemf`，纯 TS） |
| 测试 | Vitest 3.2（`environment: node`） |
| Fusion 桥 | Python 3 内置解释器 + 标准库 `ThreadingHTTPServer`，零第三方依赖，`127.0.0.1:17890` |
| 桥通信 | HTTP + JSON，CORS 仅放行本机来源，工作线程入队后经 `fireCustomEvent` 交主线程 |
| Windows 打包 | NSIS 安装包（per-user，支持 `/S` 静默） |
| macOS 打包 | DMG 分发包；本地部署使用 `.app` |
| 签名与公证 | Developer ID Application + notarytool；无证书时 ad-hoc 签名 |
| 脚本编排 | Node 22 纯 ESM、零第三方依赖 |
| CI | GitHub Actions：Windows x64、macOS arm64、macOS x64 |

## 路径约定

路径处理集中在 `desktop/threemf/paths.ts`。内部统一用 POSIX 形式做比较与相对化，只在拼装最终绝对路径时按平台换分隔符：Windows 用 `\`，macOS 用 `/`。

3MF 里保存的导出目录默认是相对工程文件的相对路径，因此同一份 3MF 在 Windows 和 macOS 上都能解析。盘符路径（`D:\`）在 macOS 上视为非法并回退到默认目录 `变体`。

## 开发启动

1. 用 Fusion 打开参数化设计。
2. 在 `desktop/` 执行 `npm install`，再 `npm run tauri dev`。启动时会比较 `bridge/payload.hash`，有变化就复制到 Fusion 的 AddIns 目录：
   - Windows：`%APPDATA%\Autodesk\Autodesk Fusion\API\AddIns\FusionBambuBridge`
   - macOS：`~/Library/Application Support/Autodesk/Autodesk Fusion/API/AddIns/FusionBambuBridge`

   两个平台都会依次尝试新目录名 `Autodesk Fusion` 与历史目录名 `Autodesk Fusion 360`。
3. 开发期复制后用 Fusion MCP 对该插件 `stop()` 再 `run(false)`；终端用户若 Fusion 还没加载桥，重启 Fusion。
4. 健康检查：`http://127.0.0.1:17890/health`。
5. 库测试：在 `desktop/` 执行 `npm test`。路径逻辑的跨平台用例在 `desktop/threemf/paths.test.ts`，通过 `setPlatform` 注入平台语义，不依赖宿主平台。
6. 把当前代码装成开发版：在 `desktop/` 执行 `npm run deploy:dev`。
   - Windows：打出 NSIS 安装包并静默装到 `%LOCALAPPDATA%\FusionBambu3mfDev`。
   - macOS：打出 `FusionBambu3mfDev.app` 并复制到 `~/Applications/FusionBambu3mfDev.app`，无需管理员权限。

   开发版与正式版用不同的 `productName` 和 `identifier`，可以共存。其他平台直接报错退出。
7. 更新打印预设目录：在 `desktop/` 执行 `npm run presets:sync`。它用 sparse checkout 只取 bambulab/BambuStudio 的 `resources/profiles`，再生成 `desktop/threemf/bambu-presets.json`。

产品版本只写在根目录 `VERSION.json`。改版本后执行 `CI_TASK=stamp node scripts/ci.mjs`，再提交被写入的版本字段和 `bridge/payload.hash`。原始模型导出为与源文件同名的 3MF，变体为 `{变体名}.3mf`。

## 发行

检查：`node scripts/ci.mjs`。它会校验桥摘要一致性并跑测试；macOS 上优先用 `python3`，Windows 上优先用 `python`。

本地安装包：`CI_TASK=package node scripts/ci.mjs`。Windows 得到 NSIS `.exe`，macOS 得到 `.dmg`，文件在 `dist/release/`。指定架构时用 `CI_TARGET_ARCH`，产物名会自动加架构后缀，避免多架构同名覆盖：

```
CI_TARGET_ARCH=aarch64-apple-darwin CI_TASK=package node scripts/ci.mjs
CI_TARGET_ARCH=x86_64-apple-darwin CI_TASK=package node scripts/ci.mjs
```

CI 在推送 `dev` 或 `stable` 标签时并行构建三个产物：Windows `.exe`、macOS arm64 `.dmg`、macOS Intel `.dmg`。两个通道共用 `VERSION.json` 里的同一个版本号：`dev` 标成预发布，`stable` 标成最新正式版。workflow 只负责检出、工具链和调用 `scripts/ci.mjs`。

### macOS 签名与公证

默认使用临时签名（ad-hoc），在本机构建的包可以直接运行。分发给其他机器时，系统会给未公证的包打上隔离标记并提示「已损坏」。两种处理方式：

- 配置正式签名：在仓库 Secrets 里设置 `APPLE_SIGNING_IDENTITY`、`APPLE_ID`、`APPLE_PASSWORD`、`APPLE_TEAM_ID`，打包时会自动签名、公证并 staple。缺任一变量则回退到 ad-hoc。
- 用户自行放行：安装后执行

  ```
  xattr -dr com.apple.quarantine /Applications/FusionBambu3mf.app
  ```

## macOS 构建依赖

- Xcode Command Line Tools（`xcode-select --install`）
- Node 22 与 Python 3（Fusion 自带解释器，系统另有 `python3` 即可）
- Rust stable 与对应架构 target：Apple Silicon 用 `aarch64-apple-darwin`，Intel 用 `x86_64-apple-darwin`
