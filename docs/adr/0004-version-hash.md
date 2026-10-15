# ADR 0004：版本号与桥 hash

## 状态

已接受

## 背景

产品版本只应有一处。桥代码变化后要复制到 Fusion 插件目录，但不能每次都手点安装。

## 决定

- 根目录 `VERSION.json` 的 `version` 是唯一版本号。释放时写入桥的 manifest。
- `bridge/payload.hash` 是桥目录内容的 SHA-256，不含该文件自身和 `__pycache__`。
- 桌面程序启动时若已安装副本的 hash 不同，则整份复制到 `%appdata%\Autodesk\Autodesk Fusion\API\AddIns`，并设置 `runOnStartup: true`。
- 开发期复制后由 Fusion MCP 重载。`stop` 必须关闭 17890 端口。

## 后果

终端用户在 Fusion 已运行且旧桥未加载时，复制完成后需要重启 Fusion。
