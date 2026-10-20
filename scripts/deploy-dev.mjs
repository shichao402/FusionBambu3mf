import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const desktopDir = join(root, 'desktop')
const productName = 'FusionBambu3mfDev'

function fail(message) {
  throw new Error(message)
}

function run(command, args, cwd) {
  const result = process.platform === 'win32'
    ? spawnSync([command, ...args].join(' '), { cwd, stdio: 'inherit', env: process.env, shell: true })
    : spawnSync(command, args, { cwd, stdio: 'inherit', env: process.env })
  if (result.error) fail(`${command} 无法启动: ${result.error.message}`)
  if (result.status !== 0) fail(`${command} ${args.join(' ')} 退出 ${result.status ?? 1}`)
}

function writeDevConfig() {
  const configPath = join(tmpdir(), 'fusionbambu-tauri-dev.json')
  writeFileSync(configPath, JSON.stringify({
    productName,
    identifier: 'dev.fusionbambu.desktop.dev',
    mainBinaryName: productName,
  }))
  return configPath
}

function deployWindows(configPath) {
  const localAppData = process.env.LOCALAPPDATA
  if (!localAppData) fail('没有 LOCALAPPDATA')
  const dest = join(localAppData, productName)

  run('npx', ['tauri', 'build', '--bundles', 'nsis', '--config', configPath], desktopDir)

  const bundleDir = join(desktopDir, 'src-tauri', 'target', 'release', 'bundle', 'nsis')
  const setup = readdirSync(bundleDir).find((name) => name.endsWith('-setup.exe'))
  if (!setup) fail(`没有在 ${bundleDir} 找到安装包`)

  spawnSync('taskkill', ['/F', '/IM', `${productName}.exe`], { stdio: 'ignore' })
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      rmSync(dest, { recursive: true, force: true })
      break
    } catch (error) {
      if (attempt === 7) fail(`关不掉正在运行的 ${productName}，目录仍被占用: ${error.message}`)
      spawnSync('taskkill', ['/F', '/IM', `${productName}.exe`], { stdio: 'ignore' })
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 400)
    }
  }
  const setupPath = join(bundleDir, setup)
  const installed = spawnSync(`"${setupPath}" /S /D=${dest}`, { stdio: 'inherit', shell: true })
  if (installed.status !== 0) fail(`安装包退出 ${installed.status ?? 1}`)

  const exe = join(dest, `${productName}.exe`)
  if (!existsSync(exe)) fail(`安装后没有找到 ${exe}`)
  return exe
}

function deployMacos(configPath) {
  const dest = join(homedir(), 'Applications', `${productName}.app`)

  run('npx', ['tauri', 'build', '--bundles', 'app', '--config', configPath], desktopDir)

  const bundleDir = join(desktopDir, 'src-tauri', 'target', 'release', 'bundle', 'macos')
  const app = readdirSync(bundleDir).find((name) => name.endsWith('.app'))
  if (!app) fail(`没有在 ${bundleDir} 找到 .app`)

  spawnSync('pkill', ['-x', productName], { stdio: 'ignore' })
  rmSync(dest, { recursive: true, force: true })
  run('ditto', [join(bundleDir, app), dest], desktopDir)

  const binary = join(dest, 'Contents', 'MacOS', productName)
  if (!existsSync(binary)) fail(`部署后没有找到 ${binary}`)
  return binary
}

const platform = process.platform
if (platform !== 'win32' && platform !== 'darwin') {
  fail(`开发版部署只支持 Windows 与 macOS，当前平台是 ${platform}`)
}

const configPath = writeDevConfig()
const target = platform === 'win32' ? deployWindows(configPath) : deployMacos(configPath)
console.log(target)
