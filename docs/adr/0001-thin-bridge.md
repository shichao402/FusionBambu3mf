# ADR 0001：Fusion 只做薄 HTTP 桥

## 状态

已接受

## 背景

打印配方和尺寸变体是表格编辑，不适合放在 Fusion 的 CommandInputs 里。几何、标星参数和网格导出必须留在 Fusion 进程内。

## 决定

- `bridge/` 是 Python 插件，只监听 `127.0.0.1:17890`。
- HTTP 工作线程不调用 Fusion API。请求入队后用 `fireCustomEvent`，在主线程执行。
- `desktop/` 通过 HTTP 调用桥。两边不共享代码。

## 后果

Fusion 已打开且桥未运行时，桌面程序不能隔空启动插件，只能提示重启 Fusion。开发期用 Fusion MCP 对插件 `stop` 再 `run`。
