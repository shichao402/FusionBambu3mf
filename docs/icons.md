# 应用图标

图标由脚本从母版生成，不手工改任何 `desktop/src-tauri/icons*` 下的文件。目录里的一切都是产物，改母版再重跑脚本即可。

## 一键重建

```
cd desktop
npm run icons
```

它会把 `assets/icons` 下每一套图标全部重建一遍。只想更新一套时用：

```
node scripts/icons.mjs --set default
node scripts/icons.mjs --set dev
node scripts/icons.mjs --list          # 看有哪些套
node scripts/icons.mjs --check         # 只校验正式版资产是否齐全
```

`npm run icons:check` 是同一件事的 npm 快捷方式，`CI_TASK=check` 也会调用它。

## 目录

```
assets/icons/
  default/
    master.png      正式版母版，1024x1024
    set.json        平台裁切参数
  dev/
    master.png      开发版母版，琥珀色
    set.json

desktop/src-tauri/
  icons/            default 的产物，tauri.conf.json 里登记的路径，随仓库提交
  icons-dev/        dev 的产物，本地按需生成，已被 .gitignore 忽略
  app-icon.png      default 的 1024 圆角预览，随仓库提交
```

`icons/` 是唯一必须入库的图标目录，因为 `tauri.conf.json` 直接引用它，CI 打包时不会先跑生成。`icons-<其他套名>` 全部视为本地构建产物，按需生成即可，不进版本库。

## 换图

把新的 1024x1024 正方形 PNG 覆盖到 `assets/icons/<套名>/master.png`，再跑 `npm run icons`。

母版要求满版、无自带圆角、无透明边距，让画面铺满整个画布。圆角和留白由脚本按平台规则自己加，这样同一张母版才能在 Windows 满版和 macOS 圆角之间复用。

## 平台差异

脚本存在的唯一理由就是这几个平台规则不一样，交给 `tauri icon` 一刀切会出错。

| 平台 | 处理 | 原因 |
| --- | --- | --- |
| macOS `icon.icns` | 内缩 100px、圆角 185px | icns 必须自带圆角和透明留白，系统不会替你裁切。参数取自 Apple 的 1024 网格：内容区 824 见方、圆角半径约为内容区的 22.4% |
| Windows `icon.ico` | 满版，不内缩 | ico 留白会让人在任务栏和资源管理器里觉得图标偏小 |
| Windows 尺寸 | 16/20/24/32/40/48/64/128/256 | `tauri icon` 默认只给 16/24/32/48/64/256，缺的 20/40/128 对应 125%–150% 的显示缩放，缺了会被插值放大变糊 |
| iOS / Android | 满版、不透明 | 圆角由系统加，图里自带圆角会出现双重圆角 |
| Android 背景色 | 由 `set.json` 的 `androidBackground` 覆写 | 自适应图标的前景层是透明的，背景色要和母版底色一致 |

`set.json` 里可以微调 `macos.inset`、`macos.radius`、`windows.inset`。如果某一套图标画面本身已经带了安全边距，就把 `inset` 调小或设成 0。

## 多套图标

`assets/icons` 下每个子目录就是一套，目录名即套名，`default` 是正式版。加一套新配色只需复制一个目录：

```
cp -r assets/icons/default assets/icons/dark
# 换掉 master.png，改 set.json 的 label
npm run icons
```

产物会写到 `desktop/src-tauri/icons-dark`。要真正用上，需要在 `tauri.conf.json` 或构建参数里把 `bundle.icon` 指过去。

开发版已经接好了：`npm run deploy:dev` 会在临时配置里把 `bundle.icon` 指向 `icons-dev`，因此开发版装出来是琥珀色图标，能和正式版在 Dock、任务栏里一眼分开。图标缺失时会先自动执行一次 `--set dev` 生成。

## 已验证

- `npm run icons` 两套齐出，各自 ico 九个尺寸齐全
- macOS 资产四角为 `alpha=0`（有透明圆角），Windows 与 iOS 资产四角不透明（满版）
- `npx tauri build --bundles app --config <dev 配置>` 能正常打出 `FusionBambu3mfDev.app`，App 图标为琥珀色
