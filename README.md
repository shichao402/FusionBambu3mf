# FusionBambu3mf

Fusion 薄桥加上 Tauri 桌面程序。Fusion 管几何和标星参数，一份 3MF 管打印配方和尺寸变体。

## 文档

- [架构](docs/architecture/overview.md)
- [桥 API](docs/architecture/bridge-api.md)
- [决策](docs/adr/0001-thin-bridge.md)
- [路线](docs/roadmap/mvp.md)
- [3MF 探测](docs/research/3mf-hierarchy.md)

## 开发启动

1. 用 Fusion 打开参数化设计。
2. 在 `desktop/` 执行 `npm install`，再 `npm run tauri dev`。启动时会比较 `bridge/payload.hash`，有变化就复制到 `%APPDATA%\Autodesk\Autodesk Fusion\API\AddIns\FusionBambuBridge`。
3. 开发期复制后用 Fusion MCP 对该插件 `stop()` 再 `run(false)`；终端用户若 Fusion 还没加载桥，重启 Fusion。
4. 健康检查：`http://127.0.0.1:17890/health`。
5. 库测试：在 `desktop/` 执行 `npm test`。

产品版本只写在根目录 `VERSION.json`。导出成品文件名为 `{变体名}.3mf`。
