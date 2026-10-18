# 架构

```text
desktop  --HTTP 127.0.0.1:17890-->  bridge  -->  Fusion 当前设计
   |                                  |
   +-- 读写源 3MF                      +-- 读参数、套参数、导出网格
   +-- 合并后写出成品 3MF
```

## 目录

```text
VERSION.json
docs/adr
docs/architecture
docs/roadmap
docs/research
bridge/                 Python 插件
desktop/                Tauri 主程序
desktop/threemf         3MF 库与 Vitest
scripts/ci.mjs          版本戳、测试、exe/dmg、发布
```

安装包把 `bridge/` 和 `VERSION.json` 打进资源目录。从仓库启动时仍读仓库里的桥；安装后的程序读包内这份。Windows 插件目录用 `%APPDATA%\Autodesk\Autodesk Fusion\API\AddIns`，macOS 用 `~/Library/Application Support/Autodesk/Autodesk Fusion/API/AddIns`。若本机仍是旧的 `Autodesk Fusion 360` 目录且该目录已存在，则复制到那里。

## 谁负责什么

- Fusion：几何、组件树、标星参数定义、当前会话里算完的模型。
- 源 3MF：`model_settings`、`project_settings`、`Metadata/fusion_batch_variants.json`。
- 成品 3MF：当时的 Fusion 网格，加上当时已保存的源配方。不回写源文件。

## 层级

对「推拉干燥盒 v18」的实测见 [3MF 探测](../research/3mf-hierarchy.md)。Fusion 导出根组件时没有写 `<components>`，而是多个网格对象，相对位置已经烘进顶点。

因此每个 Fusion 网格对象各自成为一个 Bambu 对象，下面一个同名零件，不再包进一个 `<components>` 父对象。相对位置仍留在 Fusion 写出的顶点里，不另算变换。桌面里的树仍来自 Occurrence，用路径对表。灯灭的 Body 和被抑制的 Occurrence 不进入树。

## 合并时不能做的事

- 不自行计算坐标系。`3dmodel.model` 的 transform 是 12 个数，`model_settings` 的 matrix 是 16 个数，不互相粘贴。
- 替换网格时保持 object/part 的 id，以及 `<assemble>` 里的盘子变换。
- 复制 `project_settings` 和未改写的耗材/机器侧车。不复制 `plate_*.gcode` 与 `slice_info`。
- 写入 XML 前转义 `& < >`。
- `[Content_Types].xml` 声明仍留在包内的文件。

## 桥的线程

HTTP 线程只入队并 `fireCustomEvent`。套参数、读树、导出都在主线程。批量导出一次只跑一个变体：套参数、等计算完成、导出、再下一个。结束后或取消时恢复参数。

## 保存

零件、变体、打印预设和导出目录的修改自动写回源 3MF。打印机、工艺、耗材和热床写入的是 Bambu Studio 系统预设名称。名称目录来自 bambulab/BambuStudio 的 `resources/profiles`，用 sparse checkout 跟到最新。写之前在同目录复制一份 `.bak`。

## 导出文件名

原始模型和变体走同一条生成：用当前工程里纳入的零件、层级和打印设置，套上当时的 Fusion 网格。原始模型写成与源文件同名的文件，不套变体参数。每个变体写成 `{变体名}.3mf`。名字里不能做文件名的字符换成下划线。导出文件不覆盖源 3MF。
