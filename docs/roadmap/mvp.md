# 路线

## 第一版

1. 文档、`VERSION.json`、目录。
2. 用真实装配核对 3MF 层级，写入 `docs/research/`。
3. 桥：健康检查、参数、结构、套用、恢复、导出网格；hash 与复制到 AddIns。
4. `desktop/threemf` 与测试。
5. 桌面五屏：连接、源 3MF、打印覆盖、变体、批量导出。
6. 开发期用 MCP 重载桥并请求 `/health`。

## 第一版不做

- 不改 Fusion360BatchParametricExport。
- 不导入 Excel，不导出 STEP、IGES、STL。
- 不编辑整份 `project_settings`。
- 不在桌面里建模或改 Body 名。
- 不自动把改名重新关联。
- 不自研 UI 组件，不用 Electron，不做纯静态网页发行。
- 不把 3MF 合并放进 Fusion 进程。
- 负体积和支撑加强/阻挡：源文件里已有则原样保留，界面不单独做一套。
