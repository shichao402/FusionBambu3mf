# ADR 0004：版本号与桥 hash

## 状态

已接受

## 背景

产品版本只应有一处。桥代码变化后要复制到 Fusion 插件目录，但不能每次都手点安装。

## 决定

- 根目录 `VERSION.json` 的 `version` 是唯一版本号。`scripts/ci.mjs` 在打包前把它写入桌面 `package.json`、`tauri.conf.json`、`Cargo.toml` 和桥 manifest，并重算 `payload.hash`。
- 安装包由 CI 构建：Windows 为 NSIS `.exe`，macOS 为 `.dmg`。`dev` 与 `stable` 两个标签各发一版，版本号都读 `VERSION.json`。workflow 只调用脚本，不内嵌构建步骤。安装包内带上 `bridge/` 和 `VERSION.json`。
- `bridge/payload.hash` 是桥目录内容的 SHA-256，不含该文件自身和 `__pycache__`。
- 桌面程序启动时若已安装副本的 hash 不同，则整份复制到 `%appdata%\Autodesk\Autodesk Fusion\API\AddIns`，并设置 `runOnStartup: true`。
- 开发期复制后由 Fusion MCP 重载。`stop` 必须关闭 17890 端口。

## 后果

终端用户在 Fusion 已运行且旧桥未加载时，复制完成后需要重启 Fusion。
