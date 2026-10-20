#!/usr/bin/env node
// 应用图标生成器：从 assets/icons/<set>/master.png 出发，产出各平台所需的全套图标资产。
//
// 平台差异是这个脚本存在的理由：
// - macOS 的 icns 必须自带圆角与透明留白，系统不会替你裁切。按 Apple 的 1024 网格取 824 见方、圆角 185。
// - Windows 的 ico 必须满版，留白会让任务栏和资源管理器里的图标偏小。同时补足 20/40/128 这些 Tauri 默认不生成的尺寸。
// - iOS 与 Android 要求满版且不透明，圆角由系统自己加。
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const desktopDir = join(root, 'desktop')
const assetsDir = join(root, 'assets', 'icons')
const defaultOut = join(desktopDir, 'src-tauri', 'icons')
const canvas = 1024
const icoSizes = [16, 20, 24, 32, 40, 48, 64, 128, 256]

function fail(message) {
  throw new Error(message)
}

function parseArgs(argv) {
  const options = { set: null, out: null, list: false, check: false, all: false }
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (token === '--list') options.list = true
    else if (token === '--check') options.check = true
    else if (token === '--all') options.all = true
    else if (token === '--set' || token === '--out') {
      const value = argv[index + 1]
      if (!value) fail(`${token} 缺少取值`)
      options[token.slice(2)] = value
      index += 1
    } else if (token === '--help' || token === '-h') {
      options.help = true
    } else {
      fail(`未知参数 ${token}`)
    }
  }
  return options
}

function availableSets() {
  if (!existsSync(assetsDir)) return []
  return readdirSync(assetsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(assetsDir, entry.name, 'master.png')))
    .map((entry) => entry.name)
    .sort()
}

function readPngHeader(buffer, label) {
  const signature = buffer.subarray(0, 8).toString('hex')
  if (signature !== '89504e470d0a1a0a') fail(`${label} 不是 PNG 文件`)
  if (buffer.toString('ascii', 12, 16) !== 'IHDR') fail(`${label} 缺少 IHDR 块`)
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) }
}

function loadSet(name) {
  const dir = join(assetsDir, name)
  const masterPath = join(dir, 'master.png')
  if (!existsSync(masterPath)) {
    const sets = availableSets()
    fail(`找不到图标集 ${name}：${masterPath}\n可用图标集：${sets.length ? sets.join('、') : '（无）'}`)
  }
  const configPath = join(dir, 'set.json')
  const config = existsSync(configPath) ? JSON.parse(readFileSync(configPath, 'utf8')) : {}
  const master = readFileSync(masterPath)
  const size = readPngHeader(master, relative(root, masterPath))
  if (size.width !== size.height) {
    fail(`母版必须是正方形，当前是 ${size.width}x${size.height}：${masterPath}`)
  }
  if (size.width < canvas) {
    console.warn(`提示：母版只有 ${size.width}px，建议至少 ${canvas}px，否则大尺寸图标会被放大插值`)
  }
  const macos = { inset: 100, radius: 185, ...(config.macos || {}) }
  const windows = { inset: 0, ...(config.windows || {}) }
  return {
    name,
    label: config.label || name,
    master,
    masterSize: size.width,
    macos,
    windows,
    androidBackground: config.androidBackground || '#0e1014',
  }
}

// 把位图包进 SVG 再交给 Tauri 的图标工具渲染，这样能用 clipPath 做出平台化的裁切，
// 而整个过程不需要引入任何图像处理依赖。
function shapeSvg(master, { inset, radius }) {
  const inner = canvas - inset * 2
  if (inner <= 0) fail(`inset ${inset} 过大，画布被吃掉`)
  const image = `<image x="${inset}" y="${inset}" width="${inner}" height="${inner}" preserveAspectRatio="xMidYMid slice" href="data:image/png;base64,${master.toString('base64')}"/>`
  if (!radius) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${canvas}" height="${canvas}" viewBox="0 0 ${canvas} ${canvas}">${image}</svg>`
  }
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${canvas}" height="${canvas}" viewBox="0 0 ${canvas} ${canvas}">`,
    `<defs><clipPath id="shape"><rect x="${inset}" y="${inset}" width="${inner}" height="${inner}" rx="${radius}" ry="${radius}"/></clipPath></defs>`,
    `<g clip-path="url(#shape)">${image}</g>`,
    '</svg>',
  ].join('')
}

function runTauriIcon(source, output, extraArgs = []) {
  const args = ['tauri', 'icon', source, '-o', output, ...extraArgs]
  const result = process.platform === 'win32'
    ? spawnSync(['npx', ...args].join(' '), { cwd: desktopDir, env: process.env, shell: true, stdio: 'pipe' })
    : spawnSync('npx', args, { cwd: desktopDir, env: process.env, stdio: 'pipe' })
  const log = `${result.stdout || ''}${result.stderr || ''}`.trim()
  if (result.error) fail(`无法执行 tauri icon：${result.error.message}`)
  if (result.status !== 0) fail(`tauri icon 失败（${source}）\n${log.split('\n').slice(-12).join('\n')}`)
}

// ICO 容器手写拼装：Tauri 默认只给 16/24/32/48/64/256，
// 缺 20/40/128 会让 Windows 在 125%、150% 等缩放场景下退化成插值缩放。
function buildIco(entries) {
  const count = entries.length
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(count, 4)
  const directory = Buffer.alloc(16 * count)
  let offset = 6 + 16 * count
  entries.forEach((entry, index) => {
    const base = index * 16
    directory[base] = entry.size >= 256 ? 0 : entry.size
    directory[base + 1] = entry.size >= 256 ? 0 : entry.size
    directory[base + 2] = 0
    directory[base + 3] = 0
    directory.writeUInt16LE(1, base + 4)
    directory.writeUInt16LE(32, base + 6)
    directory.writeUInt32LE(entry.buffer.length, base + 8)
    directory.writeUInt32LE(offset, base + 12)
    offset += entry.buffer.length
  })
  return Buffer.concat([header, directory, ...entries.map((entry) => entry.buffer)])
}

function copyTree(from, to, skip = []) {
  for (const entry of readdirSync(from, { withFileTypes: true })) {
    if (skip.includes(entry.name)) continue
    const source = join(from, entry.name)
    const target = join(to, entry.name)
    if (entry.isDirectory()) {
      mkdirSync(target, { recursive: true })
      copyTree(source, target, skip)
    } else {
      writeFileSync(target, readFileSync(source))
    }
  }
}

// 各平台取用不同来源：满版图给 Windows 与移动端，圆角图给 macOS。
const roundedFiles = ['icon.icns', 'icon.png', '32x32.png', '64x64.png', '128x128.png', '128x128@2x.png']
const fullBleedDirs = ['ios', 'android']
const fullBleedFiles = [
  'Square30x30Logo.png',
  'Square44x44Logo.png',
  'Square71x71Logo.png',
  'Square89x89Logo.png',
  'Square107x107Logo.png',
  'Square142x142Logo.png',
  'Square150x150Logo.png',
  'Square284x284Logo.png',
  'Square310x310Logo.png',
  'StoreLogo.png',
]

function generate(set, output) {
  const work = mkdtempSync(join(tmpdir(), 'fusionbambu-icons-'))
  try {
    const fullSvg = join(work, 'full.svg')
    const roundedSvg = join(work, 'rounded.svg')
    writeFileSync(fullSvg, shapeSvg(set.master, set.windows))
    writeFileSync(roundedSvg, shapeSvg(set.master, set.macos))

    const fullOut = join(work, 'full')
    const roundedOut = join(work, 'rounded')
    const sizesOut = join(work, 'sizes')
    const roundedSizesOut = join(work, 'rounded-sizes')

    runTauriIcon(fullSvg, fullOut)
    runTauriIcon(roundedSvg, roundedOut)
    runTauriIcon(fullSvg, sizesOut, ['--png', icoSizes.join(',')])
    runTauriIcon(roundedSvg, roundedSizesOut, ['--png', '1024'])

    const icoEntries = icoSizes.map((size) => {
      const file = join(sizesOut, `${size}x${size}.png`)
      if (!existsSync(file)) fail(`tauri icon 没有生成 ${size}x${size}.png`)
      return { size, buffer: readFileSync(file) }
    })

    rmSync(output, { recursive: true, force: true })
    mkdirSync(output, { recursive: true })
    copyTree(fullOut, output, ['icon.icns', 'icon.ico', ...roundedFiles, ...fullBleedDirs, ...fullBleedFiles])
    for (const name of fullBleedFiles) {
      const file = join(fullOut, name)
      if (existsSync(file)) writeFileSync(join(output, name), readFileSync(file))
    }
    for (const name of fullBleedDirs) {
      const dir = join(fullOut, name)
      if (existsSync(dir)) {
        mkdirSync(join(output, name), { recursive: true })
        copyTree(dir, join(output, name))
      }
    }
    for (const name of roundedFiles) {
      const file = join(roundedOut, name)
      if (existsSync(file)) writeFileSync(join(output, name), readFileSync(file))
    }
    writeFileSync(join(output, 'icon.ico'), buildIco(icoEntries))

    // 1024 圆角大图既保存在输出目录，也刷新 src-tauri/app-icon.png，
    // 让"拿去改的源文件"和"实际打包用的资产"出自同一条流水线。
    // 只有 default 图标集能改 app-icon.png，否则执行 --all 时会被 dev 覆盖。
    const preview = join(roundedSizesOut, '1024x1024.png')
    if (existsSync(preview)) {
      writeFileSync(join(output, 'icon-1024.png'), readFileSync(preview))
      if (set.name === 'default') {
        writeFileSync(join(desktopDir, 'src-tauri', 'app-icon.png'), readFileSync(preview))
      }
    }

    const backgroundFile = join(output, 'android', 'values', 'ic_launcher_background.xml')
    if (existsSync(backgroundFile)) {
      writeFileSync(backgroundFile, [
        '<?xml version="1.0" encoding="utf-8"?>',
        '<resources>',
        `  <color name="ic_launcher_background">${set.androidBackground}</color>`,
        '</resources>',
        '',
      ].join('\n'))
    }

    writeFileSync(join(output, '.icon-set.json'), `${JSON.stringify({
      set: set.name,
      label: set.label,
      masterSize: set.masterSize,
      macos: set.macos,
      windows: set.windows,
    }, null, 2)}\n`)

    return icoEntries.map((entry) => entry.size)
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
}

function check(output) {
  const required = ['icon.icns', 'icon.ico', 'icon.png', '32x32.png', '128x128.png', '128x128@2x.png']
  const missing = required.filter((name) => !existsSync(join(output, name)))
  if (missing.length) fail(`图标资产缺失：${missing.join('、')}（先执行 npm run icons）`)
  const ico = readFileSync(join(output, 'icon.ico'))
  const count = ico.readUInt16LE(4)
  const sizes = []
  for (let index = 0; index < count; index += 1) {
    const base = 6 + index * 16
    sizes.push(ico[base] === 0 ? 256 : ico[base])
  }
  const missingSizes = icoSizes.filter((size) => !sizes.includes(size))
  if (missingSizes.length) fail(`icon.ico 缺少尺寸：${missingSizes.join('、')}`)
  const png = readPngHeader(readFileSync(join(output, 'icon.png')), 'icon.png')
  if (png.width !== png.height) fail(`icon.png 不是正方形：${png.width}x${png.height}`)
  console.log(`图标资产完整：ico ${sizes.join('/')}，icon.png ${png.width}x${png.height}`)
}

const options = parseArgs(process.argv.slice(2))

function outputFor(name, explicit) {
  if (explicit) return resolve(root, explicit)
  return name === 'default' ? defaultOut : join(desktopDir, 'src-tauri', `icons-${name}`)
}

function buildOne(name, explicitOut) {
  const set = loadSet(name)
  const output = outputFor(name, explicitOut)
  const sizes = generate(set, output)
  console.log(`图标集 ${set.name}（${set.label}）：母版 ${set.masterSize}px`)
  console.log(`  macOS 内缩 ${set.macos.inset}px 圆角 ${set.macos.radius}px，Windows 内缩 ${set.windows.inset}px`)
  console.log(`  ico ${sizes.join('/')} -> ${relative(root, output)}`)
}

if (options.help) {
  console.log([
    '用法：node scripts/icons.mjs [选项]',
    '',
    '  --set <名称>   只生成指定图标集，位于 assets/icons/<名称>，默认 default',
    '  --all          一键重建 assets/icons 下的全部图标集',
    '  --out <目录>   输出目录，默认 default 写进 desktop/src-tauri/icons，其余写进 icons-<名称>',
    '  --list         列出可用图标集',
    '  --check        校验已登记的图标目录资产是否齐全',
  ].join('\n'))
} else if (options.list) {
  const sets = availableSets()
  if (!sets.length) fail(`assets/icons 下没有任何图标集`)
  for (const name of sets) {
    const config = existsSync(join(assetsDir, name, 'set.json'))
      ? JSON.parse(readFileSync(join(assetsDir, name, 'set.json'), 'utf8'))
      : {}
    console.log(`${name}\t${config.label || '-'}\t${relative(root, outputFor(name))}`)
  }
} else if (options.check) {
  check(options.out ? resolve(root, options.out) : defaultOut)
} else if (options.all) {
  const sets = availableSets()
  if (!sets.length) fail(`assets/icons 下没有任何图标集`)
  if (options.out) fail('--all 与 --out 不能一起用，各图标集各有自己的输出目录')
  for (const name of sets) buildOne(name)
} else {
  buildOne(options.set || 'default', options.out)
}
