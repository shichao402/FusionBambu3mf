# ADR 0002：桌面壳用 Tauri，界面用 Ant Design

## 状态

已接受

## 背景

主程序要读写任意本地 3MF 路径。纯浏览器页面做不到。桥和主程序只通过 HTTP 通信，没有必要为了和桥同语言而用 Python 壳。

## 决定

- 壳：Tauri 2。
- UI：React 18、Vite、Ant Design 5、`zh_CN`。
- 只组合现成组件，不自研控件。
- 3MF 读写放在 `desktop/threemf`，用 Vitest 测试。

## 后果

开发机需要 Node 与 Rust。界面是表单和表格，不追求品牌站样式。
