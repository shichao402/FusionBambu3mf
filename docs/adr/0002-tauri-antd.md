# ADR 0002：桌面壳用 Tauri，界面按桌面客户端来

## 状态

已接受。原先的 Ant Design 后台布局已替换。

## 背景

主程序要读写任意本地 3MF 路径。纯浏览器页面做不到。桥和主程序只通过 HTTP 通信，没有必要为了和桥同语言而用 Python 壳。

Ant Design 的侧栏加卡片更像管理后台，空页留白大，也不像日常用的桌面客户端。

## 决定

- 壳：Tauri 2。
- UI：React、Vite、Tailwind 设计 token、Radix 对话框、lucide 图标。布局参照 Dec Console：深色侧栏、顶栏、概览统计、面板和空状态。
- 零件、变体、打印预设、导出目录都在界面里改。不要求手写 JSON 或 XML。
- 3MF 读写放在 `desktop/threemf`，用 Vitest 测试。

## 后果

开发机需要 Node 与 Rust。颜色和间距走 token，页面不再直接铺一套组件库主题。
