# 桥 HTTP API

基址：`http://127.0.0.1:17890`

响应头包含 `Access-Control-Allow-Origin: *`，只供本机 WebView 使用。监听地址不是 `0.0.0.0`。

## GET /health

```json
{
  "ok": true,
  "version": "0.1.0",
  "documentName": "当前文档",
  "hasDesign": true
}
```

## GET /parameters

标星的用户参数。

```json
{
  "parameters": [
    { "name": "length", "expression": "10 mm", "comment": "", "unit": "mm" }
  ]
}
```

## GET /structure

可见组件树。`path` 用 `/` 连接。

```json
{
  "nodes": [
    {
      "kind": "component",
      "name": "底座",
      "path": "底座",
      "children": [
        { "kind": "body", "name": "主体", "path": "底座/主体", "children": [] }
      ]
    }
  ]
}
```

## POST /parameters/apply

```json
{ "parameters": { "length": "12 mm" } }
```

先备份当前表达式，再写入，并等待设计计算完成。

## POST /parameters/restore

恢复最近一次备份。没有备份时返回错误。

## POST /export/mesh3mf

```json
{ "directory": "C:\\\\temp" }
```

把根组件导出为一个 3MF，`isOneFilePerBody` 为 false。返回：

```json
{ "path": "C:\\\\temp\\\\fusion-mesh.3mf" }
```

文件是几何包。打印配方由桌面程序合并进去。
