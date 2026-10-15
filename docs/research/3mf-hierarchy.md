# Fusion 3MF 层级探测

探测对象：当前打开的设计「推拉干燥盒 v18」。根组件下有两个可见一级组件「盒子」「盖子」，各有一个同名 Body，没有更深的子组件。导出使用 `createC3MFExportOptions(root, path)`，`isOneFilePerBody = false`，低网格精度。

## 包里有什么

- `3D/3dmodel.model`
- `Metadata/thumbnail.png`
- `[Content_Types].xml`
- `_rels/.rels`

没有 `model_settings.config`。打印配方不是 Fusion 写的。

## 3dmodel.model

- 没有 `<components>`。
- 两个 `<object>`，名字是组件名「盒子」「盖子」，不是 Occurrence 名「盒子:1」。
- 两个 `<build><item>`，没有 transform。
- 相对位置烘进顶点。盒子 Y 从 0 到 16，盖子 Y 从 9 到 16，X/Z 范围重叠。单位已是毫米（长度 28 mm 对应 X 从 -14 到 14）。

## 结论

Fusion 这次写出的是同一装配坐标系里的多个网格对象，不是 3MF 组件树。Bambu 只有在把这些对象收成**一个 object 的多个 part** 时，才会保住盖子和盒子的相对位置。若分成两个独立对象，切片器会各自落到盘上。

因此合并规则是：

- 一次导出根组件。
- `model_settings` 里用一个 object，名字用文档名。
- Fusion 的每个 mesh object 成为一个 part。matrix 用单位 16 个数，不把顶点再变换一次。
- object/part 的 id 在以后替换网格时保持不变。`<assemble>` 只表达这个 object 在盘上的位置。
- 桌面里的树仍来自 Fusion Occurrence，用路径对表。和网格对象匹配时，优先用路径最后一段；重名时再用完整路径。本次样本没有重名。

本次设计每个组件只有一个 Body，不能证明「一个组件里多个 Body」会拆成多个 object。修改器若是独立 Body，要再导出一次才能确认。在确认前，桥按 Fusion 实际写出的 object 来生成 part，不把一个 object 拆开。

12 个数的 transform 与 16 个数的 matrix 仍然不互相粘贴。这次导出的 item 上没有 12 个数的 transform。
