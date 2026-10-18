import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const checkout = join(root, 'vendor', 'BambuStudio')
const remote = 'https://github.com/bambulab/BambuStudio.git'
const branch = 'master'
const sparsePath = 'resources/profiles'
const profiles = join(checkout, sparsePath)
const catalogPath = join(root, 'desktop', 'threemf', 'bambu-presets.json')

function fail(message) {
  throw new Error(message)
}

function git(args, cwd = checkout) {
  const result = spawnSync('git', args, { cwd, stdio: 'inherit', env: process.env })
  if (result.error) fail(`git 无法启动: ${result.error.message}`)
  if (result.status !== 0) fail(`git ${args.join(' ')} 退出 ${result.status ?? 1}`)
}

function gitOut(args) {
  const result = spawnSync('git', args, { cwd: checkout, encoding: 'utf8', env: process.env })
  if (result.error) fail(`git 无法启动: ${result.error.message}`)
  if (result.status !== 0) fail(`git ${args.join(' ')} 退出 ${result.status ?? 1}`)
  return result.stdout.trim()
}

function ensureCheckout() {
  mkdirSync(dirname(checkout), { recursive: true })
  if (!existsSync(join(checkout, '.git'))) {
    git(['clone', '--depth', '1', '--filter=blob:none', '--sparse', '--branch', branch, remote, checkout], root)
  }
  git(['sparse-checkout', 'set', sparsePath])
  git(['fetch', '--depth', '1', 'origin', branch])
  git(['reset', '--hard', `origin/${branch}`])
}

function chain(byName, name) {
  const seen = []
  const guard = new Set()
  let current = byName.get(name)
  while (current && !guard.has(current.name)) {
    guard.add(current.name)
    seen.push(current)
    current = current.inherits ? byName.get(current.inherits) : undefined
  }
  return seen
}

function firstValue(byName, name, key) {
  for (const node of chain(byName, name)) {
    const value = node[key]
    if (value == null) continue
    return Array.isArray(value) ? value.map(String) : [String(value)]
  }
  return []
}

function scalar(byName, name, key, fallback = '') {
  return firstValue(byName, name, key)[0] ?? fallback
}

function buildCatalog(sha) {
  const index = JSON.parse(readFileSync(join(profiles, 'BBL.json'), 'utf8'))
  const rootDir = join(profiles, 'BBL')
  const byName = new Map()
  for (const dir of ['machine', 'process', 'filament']) {
    for (const file of readdirSync(join(rootDir, dir))) {
      if (!file.endsWith('.json')) continue
      const parsed = JSON.parse(readFileSync(join(rootDir, dir, file), 'utf8'))
      if (parsed.name) byName.set(parsed.name, parsed)
    }
  }

  const beds = new Set([
    'Cool Plate',
    'Engineering Plate',
    'Smooth PEI Plate / High Temp Plate',
    'Textured PEI Plate',
    'Supertack Plate',
    'Textured Cool Plate',
  ])
  for (const node of byName.values()) {
    if (node.default_bed_type) beds.add(String(node.default_bed_type))
  }

  const printers = [...byName.values()]
    .filter((node) => node.type === 'machine' && node.instantiation === 'true' && !String(node.name).includes('template'))
    .map((node) => ({
      id: node.name,
      model: scalar(byName, node.name, 'printer_model', node.printer_model || node.name),
      nozzle: scalar(byName, node.name, 'nozzle_diameter', '0.4'),
      process: scalar(byName, node.name, 'default_print_profile'),
      filament: firstValue(byName, node.name, 'default_filament_profile')[0] || '',
      bed: scalar(byName, node.printer_model || node.name, 'default_bed_type', 'Textured PEI Plate'),
      extruder: scalar(byName, node.name, 'extruder_type', 'Direct Drive'),
    }))
    .sort((a, b) => a.id.localeCompare(b.id))

  const printerIndex = new Map(printers.map((printer, index) => [printer.id, index]))
  function printerRefs(names) {
    if (!Array.isArray(names)) return []
    return [...new Set(names.map((name) => printerIndex.get(String(name))).filter((index) => index != null))].sort((a, b) => a - b)
  }

  const processes = [...byName.values()]
    .filter((node) => node.type === 'process' && node.instantiation === 'true')
    .map((node) => ({ id: node.name, printers: printerRefs(node.compatible_printers) }))
    .filter((node) => node.printers.length > 0)
    .sort((a, b) => a.id.localeCompare(b.id))

  const filaments = [...byName.values()]
    .filter((node) => node.type === 'filament' && node.instantiation === 'true')
    .map((node) => ({
      id: node.name,
      type: scalar(byName, node.name, 'filament_type', 'PLA'),
      vendor: scalar(byName, node.name, 'filament_vendor', 'Generic'),
      filamentId: scalar(byName, node.name, 'filament_id'),
      printers: printerRefs(node.compatible_printers),
    }))
    .filter((node) => node.printers.length > 0)
    .sort((a, b) => a.type.localeCompare(b.type) || a.vendor.localeCompare(b.vendor) || a.id.localeCompare(b.id))

  return {
    source: `bambulab/BambuStudio@${sha} resources/profiles BBL ${index.version}`,
    beds: [...beds].sort(),
    printers,
    processes,
    filaments,
  }
}

ensureCheckout()
const sha = gitOut(['rev-parse', '--short=12', 'HEAD'])
const catalog = buildCatalog(sha)
writeFileSync(catalogPath, JSON.stringify(catalog))
const a1 = catalog.printers.find((printer) => printer.id === 'Bambu Lab A1 0.4 nozzle')
console.log(`${catalog.source}`)
console.log(`printers ${catalog.printers.length}, processes ${catalog.processes.length}, filaments ${catalog.filaments.length}`)
console.log(a1 ? `default ${a1.id} / ${a1.process} / ${a1.filament} / ${a1.bed}` : '没有找到 A1 0.4 默认预设')
