# FusionBambu3mf

Fusion 薄 HTTP 桥 + Tauri 桌面程序：以一份 Bambu/Orca 工程 3MF 为唯一配置来源，在桌面端编辑修改器与尺寸变体，经 Fusion 套参数并导出带完整打印配置的 3MF。

详细设计见 [`.cursor/plans/bambu3mf导出计划.md`](.cursor/plans/bambu3mf导出计划.md)。

## 仓库状态

当前为新建空仓，计划已迁入。实现按计划顺序推进：探测 3MF → 桥 → `packages/3mf` → 桌面壳 → 安装与文档。

## 与旧项目的关系

独立于 [Fusion360BatchParametricExport](https://github.com/shichao402/Fusion360BatchParametricExport)。旧项目保持原样，不在本仓迁移 Excel/STEP 等旧导出流程。
