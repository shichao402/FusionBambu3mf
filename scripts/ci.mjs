import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const bridgeDir = join(root, 'bridge')
const desktopDir = join(root, 'desktop')

function fail(message) {
  throw new Error(message)
}

function readVersion() {
  const parsed = JSON.parse(readFileSync(join(root, 'VERSION.json'), 'utf8'))
  if (typeof parsed.version !== 'string' || !/^\d+\.\d+\.\d+$/.test(parsed.version)) {
    fail('VERSION.json 的 version 必须是 x.y.z')
  }
  return parsed.version
}

function walkFiles(dir) {
  const entries = readdirSync(dir, { withFileTypes: true })
  const directories = entries.filter((entry) => entry.isDirectory() && entry.name !== '__pycache__').map((entry) => entry.name).sort()
  const filenames = entries.filter((entry) => entry.isFile()).map((entry) => entry.name).sort()
  const files = []
  for (const name of filenames) {
    if (name === 'payload.hash' || name.endsWith('.pyc')) continue
    files.push(join(dir, name))
  }
  for (const name of directories) files.push(...walkFiles(join(dir, name)))
  return files
}

function payloadDigest(dir) {
  const hash = createHash('sha256')
  for (const path of walkFiles(dir)) {
    const relative = path.slice(dir.length + 1).replaceAll('\\', '/')
    hash.update(relative)
    hash.update(Buffer.from([0]))
    hash.update(readFileSync(path))
    hash.update(Buffer.from([0]))
  }
  return hash.digest('hex')
}

function pythonDigest() {
  const code = 'import os,hash_payload; print(hash_payload.payload_digest(os.environ["BRIDGE_ROOT"]))'
  for (const bin of ['python', 'python3']) {
    const result = spawnSync(bin, ['-c', code], {
      cwd: bridgeDir,
      env: { ...process.env, BRIDGE_ROOT: bridgeDir },
      encoding: 'utf8',
    })
    if (result.status === 0) return result.stdout.trim()
  }
  fail('需要 python 来核对 payload.hash')
}

function replaceVersion(path, pattern, version, write) {
  const raw = readFileSync(path, 'utf8')
  pattern.lastIndex = 0
  if (!pattern.test(raw)) fail(`找不到版本字段: ${path}`)
  const next = raw.replace(pattern, (_match, prefix, suffix) => `${prefix}${version}${suffix}`)
  if (next === raw) return false
  if (!write) fail(`${path} 的版本不是 ${version}。先执行 CI_TASK=stamp`)
  writeFileSync(path, next)
  return true
}

function stamp(version, write) {
  const jsonVersion = /("version"\s*:\s*")[^"]*(")/
  const cargoVersion = /^(version\s*=\s*")[^"]*(")/m
  replaceVersion(join(desktopDir, 'package.json'), jsonVersion, version, write)
  replaceVersion(join(desktopDir, 'src-tauri', 'tauri.conf.json'), jsonVersion, version, write)
  replaceVersion(join(desktopDir, 'src-tauri', 'Cargo.toml'), cargoVersion, version, write)
  replaceVersion(join(bridgeDir, 'FusionBambuBridge.manifest'), jsonVersion, version, write)
}

function writeHash() {
  const digest = payloadDigest(bridgeDir)
  const python = pythonDigest()
  if (digest !== python) fail(`payload hash 不一致\nnode ${digest}\npython ${python}`)
  const file = join(bridgeDir, 'payload.hash')
  const next = `${digest}\n`
  if (!existsSync(file) || readFileSync(file, 'utf8') !== next) writeFileSync(file, next)
  return digest
}

function releaseChannel() {
  const ref = process.env.GITHUB_REF || ''
  if (!ref.startsWith('refs/tags/')) return ''
  const tag = ref.split('/').pop()
  if (tag !== 'dev' && tag !== 'stable') fail(`标签必须是 dev 或 stable，当前是 ${tag}`)
  return tag
}

function run(command, args, cwd) {
  const result = process.platform === 'win32'
    ? spawnSync(`${command} ${args.join(' ')}`, { cwd, stdio: 'inherit', env: process.env, shell: true })
    : spawnSync(command, args, { cwd, stdio: 'inherit', env: process.env })
  if (result.error) fail(`${command} 无法启动: ${result.error.message}`)
  if (result.status !== 0) fail(`${command} ${args.join(' ')} 退出 ${result.status ?? 1}`)
}

function installAndTest() {
  run('npm', ['ci'], desktopDir)
  run('npm', ['test'], desktopDir)
}

function bundleName() {
  if (process.platform === 'win32') return 'nsis'
  if (process.platform === 'darwin') return 'dmg'
  fail('安装包只在 Windows（exe）和 macOS（dmg）上构建')
}

function collectInstallers() {
  const bundle = bundleName()
  const from = join(desktopDir, 'src-tauri', 'target', 'release', 'bundle', bundle)
  const output = join(root, 'dist', 'release')
  mkdirSync(output, { recursive: true })
  const names = readdirSync(from).filter((name) => name.endsWith('.exe') || name.endsWith('.dmg'))
  if (!names.length) fail(`没有在 ${from} 找到安装包`)
  for (const name of names) copyFileSync(join(from, name), join(output, name))
  console.log(names.map((name) => join('dist', 'release', name)).join('\n'))
}

function publish(version) {
  const channel = releaseChannel()
  if (!channel) fail('publish 需要 dev 或 stable 标签')
  const output = join(root, 'dist', 'release')
  const files = readdirSync(output)
    .filter((name) => name.endsWith('.exe') || name.endsWith('.dmg'))
    .map((name) => join(output, name))
  if (!files.length) fail('dist/release 里没有 exe 或 dmg')
  const title = `FusionBambu3mf ${version} (${channel})`
  const notes = `${channel} 通道。版本号 ${version} 来自 VERSION.json，dev 与 stable 共用这个版本号。`
  const view = spawnSync('gh', ['release', 'view', channel], { cwd: root, stdio: 'ignore' })
  if (view.status === 0) {
    run('gh', ['release', 'upload', channel, '--clobber', ...files], root)
    run('gh', ['release', 'edit', channel, '--title', title, '--notes', notes], root)
    return
  }
  const args = ['release', 'create', channel, '--title', title, '--notes', notes, ...files]
  if (channel === 'dev') args.push('--prerelease')
  if (channel === 'stable') args.push('--latest')
  run('gh', args, root)
}

const task = process.env.CI_TASK || 'check'
const version = readVersion()

if (task === 'check') {
  stamp(version, false)
  const digest = payloadDigest(bridgeDir)
  const python = pythonDigest()
  const recorded = readFileSync(join(bridgeDir, 'payload.hash'), 'utf8').trim()
  if (digest !== python || digest !== recorded) {
    fail(`payload.hash 与 VERSION.json 对应的桥内容不一致\nfile ${recorded}\nnode ${digest}\npython ${python}`)
  }
  installAndTest()
} else if (task === 'stamp') {
  stamp(version, true)
  console.log(writeHash())
} else if (task === 'package') {
  releaseChannel()
  stamp(version, true)
  console.log(writeHash())
  installAndTest()
  run('npx', ['tauri', 'build', '--bundles', bundleName()], desktopDir)
  collectInstallers()
} else if (task === 'publish') {
  publish(version)
} else {
  fail(`未知 CI_TASK ${task}`)
}
