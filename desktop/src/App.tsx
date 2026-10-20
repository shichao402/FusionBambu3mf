import { invoke } from '@tauri-apps/api/core'
import { FilePlus2, FolderOpen } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  applyParameters,
  exportMesh,
  getHealth,
  getParameters,
  getStructure,
  restoreParameters,
  type Health,
  type ParameterInfo,
  type StructureNode,
} from '@/bridge'
import { Button } from '@/components/ui/button'
import { ToastList } from '@/components/ui/feedback'
import { Sidebar } from '@/components/shell/sidebar'
import { TopBar } from '@/components/shell/top-bar'
import { subtypeLabel } from '@/bambuLabels'
import { VIEW_CRUMBS, type View } from '@/lib/views'
import { ExportPage } from '@/pages/export-page'
import { LinkPage } from '@/pages/link-page'
import { OverviewPage } from '@/pages/overview-page'
import { PartsPage, type AlignRow } from '@/pages/parts-page'
import { VariantsPage } from '@/pages/variants-page'
import {
  createFromFusionMesh,
  DEFAULT_EXPORT_DIR,
  derivePackage,
  fusionMeshName,
  includeFusionMesh,
  listParts,
  membersFromAlignment,
  nestMembers,
  readProject,
  relativeExportDir,
  removePart,
  resolveExportDir,
  setPrintChoice,
  toBytes,
  updatePart,
  type Project3mf,
} from '../threemf/package'
import { detectPlatform, setPlatform } from '../threemf/paths'

type BridgeStatus = {
  sourceHash: string
  installedHash: string
  dest: string
  copied: boolean
  version: string
}

type Toast = { id: number; tone: 'good' | 'bad' | 'warn'; text: string }

function flatten(nodes: StructureNode[]): StructureNode[] {
  return nodes.flatMap((node) => [node, ...flatten(node.children)])
}

function alignLeaves(nodes: StructureNode[]): StructureNode[] {
  const bodies = flatten(nodes).filter((node) => node.kind === 'body')
  return bodies.length ? bodies : flatten(nodes).filter((node) => node.kind === 'component')
}

function alignKeys(node: StructureNode): string[] {
  const last = node.path.split('/').pop() || node.name
  return [...new Set([last, last.replace(/:\d+$/, ''), node.name, node.componentName].filter((item): item is string => Boolean(item)))]
}

function inShell(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

function joinPath(dir: string, name: string): string {
  const sep = dir.includes('\\') ? '\\' : '/'
  return `${dir.replace(/[/\\]+$/, '')}${sep}${name}`
}

function fileStem(path: string): string {
  const base = path.split(/[/\\]/).pop() || '原始模型'
  return base.replace(/\.3mf$/i, '') || '原始模型'
}

function safeFileName(name: string): string {
  return `${name}.3mf`.replace(/[<>:"/\\|?*]/g, '_')
}

async function readPath(path: string): Promise<Uint8Array> {
  const bytes = await invoke<number[]>('read_bytes', { path })
  return Uint8Array.from(bytes)
}

async function writePath(path: string, bytes: Uint8Array) {
  await invoke('write_bytes', { path, bytes: Array.from(bytes) })
}

export default function App() {
  const [health, setHealth] = useState<Health | null>(null)
  const [healthError, setHealthError] = useState('')
  const [bridge, setBridge] = useState<BridgeStatus | null>(null)
  const [parameters, setParameters] = useState<ParameterInfo[]>([])
  const [structure, setStructure] = useState<StructureNode[]>([])
  const [sourcePath, setSourcePath] = useState('')
  const [project, setProject] = useState<Project3mf | null>(null)
  const [selectedPartId, setSelectedPartId] = useState('')
  const [selectedVariants, setSelectedVariants] = useState<string[]>([])
  const [exportOriginal, setExportOriginal] = useState(true)
  const [progress, setProgress] = useState('')
  const [including, setIncluding] = useState('')
  const [justCopied, setJustCopied] = useState(false)
  const [view, setView] = useState<View>('overview')
  const [toasts, setToasts] = useState<Toast[]>([])
  const toastId = useRef(0)
  const cancelExport = useRef(false)
  const includingRef = useRef('')
  const projectRef = useRef<Project3mf | null>(null)
  const sourcePathRef = useRef('')
  const saveTimer = useRef<number | null>(null)
  const saving = useRef<Promise<void> | null>(null)
  const flushRef = useRef<() => Promise<boolean>>(async () => true)

  const notify = useCallback((tone: Toast['tone'], text: string) => {
    const id = toastId.current + 1
    toastId.current = id
    setToasts((items) => [...items, { id, tone, text }])
    window.setTimeout(() => setToasts((items) => items.filter((item) => item.id !== id)), 4200)
  }, [])

  const refreshBridge = useCallback(async () => {
    if (!inShell()) return
    const status = await invoke<BridgeStatus>('sync_bridge')
    setBridge(status)
    if (status.copied) setJustCopied(true)
  }, [])

  const refreshHealth = useCallback(async () => {
    try {
      const next = await getHealth()
      setHealth(next)
      setHealthError('')
      if (next.hasDesign) {
        const [params, tree] = await Promise.all([getParameters(), getStructure()])
        setParameters(params.parameters)
        setStructure(tree.nodes)
      }
    } catch (error) {
      setHealth(null)
      setHealthError(error instanceof Error ? error.message : String(error))
    }
  }, [])

  useEffect(() => {
    invoke<string>('host_platform')
      .then((platform) => setPlatform(platform === 'windows' ? 'windows' : 'posix'))
      .catch(() => setPlatform(detectPlatform()))
    refreshBridge().catch((error) => notify('bad', String(error)))
    const timer = window.setInterval(() => {
      refreshHealth().catch(() => undefined)
    }, 3000)
    refreshHealth().catch(() => undefined)
    const onHide = () => { void flushRef.current() }
    window.addEventListener('blur', onHide)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('blur', onHide)
    }
  }, [notify, refreshBridge, refreshHealth])

  const parts = useMemo(() => (project ? listParts(project) : []), [project])
  const selected = parts.find((item) => item.part.id === selectedPartId)
  const alignment = useMemo<AlignRow[]>(() => {
    const leaves = alignLeaves(structure)
    const used = new Set<string>()
    const rows: AlignRow[] = []
    const explicit = project?.members
    leaves.forEach((node) => {
      const keys = alignKeys(node)
      const meshName = fusionMeshName(node.path)
      const member = explicit?.find((item) => item.path === node.path)
      const part = explicit
        ? (member ? parts.find((row) => row.part.metadata.name === member.name) : undefined)
        : parts.find((row) => keys.includes(row.part.metadata.name || ''))
      if (part && (!explicit || member)) {
        used.add(part.part.id)
        rows.push({ key: `both-${node.path}`, status: '已对齐', label: node.path, path: node.path, meshName: part.part.metadata.name || meshName, partId: part.part.id })
      } else {
        rows.push({
          key: `fusion-${node.path}`,
          status: '仅 Fusion 有',
          label: node.path,
          path: node.path,
          meshName,
        })
      }
    })
    parts.forEach((row) => {
      if (used.has(row.part.id)) return
      rows.push({
        key: `3mf-${row.part.id}`,
        status: '仅工程有',
        label: row.part.metadata.name || row.part.id,
        meshName: row.part.metadata.name || '',
        partId: row.part.id,
      })
    })
    return rows
  }, [parts, project, structure])

  const partTree = project ? project.objects.map((objectNode) => {
    const lone = objectNode.parts.length === 1 && (objectNode.parts[0].metadata.name || '') === (objectNode.metadata.name || '')
    if (lone) {
      const part = objectNode.parts[0]
      return { key: part.id, title: `${part.metadata.name || part.id} · ${subtypeLabel(part.subtype)}` }
    }
    return {
      key: `object-${objectNode.id}`,
      title: `对象 ${objectNode.metadata.name || objectNode.id}`,
      children: objectNode.parts.map((part) => ({
        key: part.id,
        title: `${part.metadata.name || part.id} · ${subtypeLabel(part.subtype)}`,
      })),
    }
  }) : []

  function remember(next: Project3mf, path = sourcePathRef.current) {
    projectRef.current = next
    sourcePathRef.current = path
    setProject(next)
    setSourcePath(path)
  }

  function scheduleSave() {
    if (saveTimer.current) window.clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(() => {
      saveTimer.current = null
      void flushSave()
    }, 400)
  }

  function mark(next: Project3mf) {
    projectRef.current = next
    setProject(next)
    scheduleSave()
  }

  async function openSource() {
    if (!inShell()) {
      notify('warn', '打开文件要在桌面程序里进行。')
      return
    }
    if (!(await flushSave())) return
    const path = await invoke<string | null>('pick_open')
    if (!path) return
    const loaded = readProject(await readPath(path))
    const changed = applyHierarchy(loaded)
    remember(loaded, path)
    setSelectedPartId(loaded.objects[0]?.parts[0]?.id || '')
    setSelectedVariants(loaded.variants.map((variant) => variant.name))
    setExportOriginal(true)
    if (changed) scheduleSave()
  }

  async function saveSource(target = sourcePathRef.current, snapshot: Project3mf | null = projectRef.current, options?: { silent?: boolean }) {
    if (!snapshot) return
    if (!inShell()) {
      if (!options?.silent) notify('warn', '保存要在桌面程序里进行。')
      return
    }
    if (!target) {
      if (!options?.silent) await saveAs()
      return
    }
    const bak = `${target}.bak`
    try {
      await writePath(bak, await readPath(target))
    } catch {
      // 新文件还没有可备份的内容。
    }
    applyHierarchy(snapshot)
    await writePath(target, toBytes(snapshot))
    sourcePathRef.current = target
    setSourcePath(target)
    if (!options?.silent) notify('good', '已写回工程')
  }

  async function flushSave(): Promise<boolean> {
    if (saveTimer.current) {
      window.clearTimeout(saveTimer.current)
      saveTimer.current = null
    }
    while (saving.current) {
      try {
        await saving.current
      } catch {
        // 上一轮失败时已经提示过。
      }
    }
    const snapshot = projectRef.current
    const target = sourcePathRef.current
    if (!snapshot || !target) return true
    const task = saveSource(target, snapshot, { silent: true })
    saving.current = task
    let ok = true
    try {
      await task
    } catch (error) {
      ok = false
      notify('bad', error instanceof Error ? error.message : String(error))
    } finally {
      if (saving.current === task) saving.current = null
    }
    if (ok && projectRef.current !== snapshot) return flushSave()
    return ok
  }
  flushRef.current = flushSave

  async function saveAs() {
    if (!inShell()) {
      notify('warn', '另存为要在桌面程序里进行。')
      return
    }
    const path = await invoke<string | null>('pick_save')
    if (!path || !projectRef.current) return
    await saveSource(path, projectRef.current)
  }

  async function createFromModel() {
    if (!inShell()) {
      notify('warn', '从当前模型新建要在桌面程序里进行。')
      return
    }
    if (!(await flushSave())) return
    if (!health?.hasDesign) {
      notify('warn', '先连接 Fusion')
      return
    }
    const path = await invoke<string | null>('pick_save')
    if (!path) return
    const exported = await exportMesh()
    const created = createFromFusionMesh(await readPath(exported.path), health.documentName || '未命名')
    created.members = membersFromAlignment(
      alignLeaves(structure).map((node) => ({ path: node.path, keys: alignKeys(node) })),
      listParts(created).map((row) => row.part.metadata.name || ''),
    )
    nestMembers(created)
    remember(created, path)
    setSelectedPartId(created.objects[0]?.parts[0]?.id || '')
    setSelectedVariants([])
    setExportOriginal(true)
    await saveSource(path, created)
  }

  function patchPart(metadata: Record<string, string>, subtype?: string) {
    if (!project || !selected) return
    const removeKeys = Object.keys(metadata).filter((key) => metadata[key] === '')
    updatePart(project, selected.part.id, { metadata, subtype, removeKeys })
    mark({ ...project, objects: project.objects.map((objectNode) => ({ ...objectNode, parts: objectNode.parts.map((part) => ({ ...part, metadata: { ...part.metadata } })) })) })
  }

  function refreshProject(next: Project3mf) {
    mark({
      ...next,
      members: next.members ? next.members.map((item) => ({ ...item })) : null,
      objects: next.objects.map((objectNode) => ({ ...objectNode, parts: objectNode.parts.map((part) => ({ ...part, metadata: { ...part.metadata } })) })),
    })
  }

  function applyHierarchy(target: Project3mf): boolean {
    const previous = target.members
    if (!target.members && structure.length) {
      target.members = membersFromAlignment(
        alignLeaves(structure).map((node) => ({ path: node.path, keys: alignKeys(node) })),
        listParts(target).map((row) => row.part.metadata.name || ''),
      )
    }
    const changed = nestMembers(target)
    if (!changed && !previous) target.members = previous
    return changed
  }

  function recordedMembers() {
    if (!project) return []
    if (project.members) return project.members.map((item) => ({ ...item }))
    return membersFromAlignment(
      alignLeaves(structure).map((node) => ({ path: node.path, keys: alignKeys(node) })),
      parts.map((row) => row.part.metadata.name || ''),
    )
  }

  async function includeNode(path: string, meshName: string) {
    if (!project || !health?.hasDesign) {
      notify('warn', '先连接 Fusion')
      return
    }
    if (includingRef.current) return
    includingRef.current = path
    setIncluding(path)
    try {
      const base = recordedMembers().filter((item) => item.path !== path)
      const already = parts.some((row) => row.part.metadata.name === meshName)
      if (!already) {
        const mesh = await exportMesh()
        includeFusionMesh(project, await readPath(mesh.path), meshName)
      }
      const latest = project.members ? project.members.filter((item) => item.path !== path) : base
      project.members = [...latest, { path, name: meshName }]
      nestMembers(project)
      refreshProject(project)
      notify('good', `已纳入「${meshName}」`)
    } catch (error) {
      notify('bad', error instanceof Error ? error.message : String(error))
    } finally {
      includingRef.current = ''
      setIncluding('')
    }
  }

  function excludeNode(path: string, partId: string) {
    if (!project || includingRef.current) return
    project.members = recordedMembers().filter((item) => item.path !== path)
    if (partId) {
      removePart(project, partId)
      if (selectedPartId === partId) setSelectedPartId('')
    }
    refreshProject(project)
  }

  function deletePart(partId: string) {
    if (!project) return
    const name = parts.find((row) => row.part.id === partId)?.part.metadata.name
    removePart(project, partId)
    if (selectedPartId === partId) setSelectedPartId('')
    if (project.members && name) project.members = project.members.filter((item) => item.name !== name)
    refreshProject(project)
  }

  function changePrint(patch: { printerId?: string; processId?: string; filamentId?: string; bed?: string }) {
    if (!project) return
    setPrintChoice(project, patch)
    mark({ ...project })
  }

  function changeExportDir(absolute: string) {
    if (!project || !sourcePath) return
    const relative = relativeExportDir(sourcePath, absolute)
    if (!relative) {
      notify('warn', '导出目录要和这份 3MF 在同一位置下，才能记成相对路径。')
      return
    }
    mark({ ...project, exportDir: relative })
  }

  async function runExport() {
    if (!(await flushSave())) return
    const recipe = projectRef.current
    const target = sourcePathRef.current
    const exportDir = recipe && target ? resolveExportDir(target, recipe.exportDir || DEFAULT_EXPORT_DIR) : ''
    if (!recipe || !target || !exportDir) {
      notify('warn', '需要已打开的工程和导出目录')
      return
    }
    const jobs: { label: string; fileName: string; parameters: Record<string, string> | null }[] = []
    if (exportOriginal) jobs.push({ label: '原始模型', fileName: safeFileName(fileStem(target)), parameters: null })
    if (parameters.length) {
      recipe.variants.filter((variant) => selectedVariants.includes(variant.name)).forEach((variant) => {
        jobs.push({ label: variant.name, fileName: safeFileName(variant.name), parameters: variant.parameters })
      })
    }
    if (!jobs.length) {
      notify('warn', '没有要导出的文件')
      return
    }
    let failed = 0
    let applied = false
    cancelExport.current = false
    try {
      for (let index = 0; index < jobs.length; index += 1) {
        if (cancelExport.current) break
        const job = jobs[index]
        setProgress(job.parameters ? `${job.label}：套参数` : `${job.label}：导出网格`)
        try {
          if (job.parameters) {
            await applyParameters(job.parameters, !applied)
            applied = true
            setProgress(`${job.label}：导出网格`)
          }
          const mesh = await exportMesh()
          const derived = derivePackage(recipe, await readPath(mesh.path), health?.documentName || fileStem(target))
          if (derived.omitted.length) notify('warn', `${job.label}：这些零件这次网格里没有，已跳过：${derived.omitted.join('、')}`)
          setProgress(`${job.label}：写入`)
          await writePath(joinPath(exportDir, job.fileName), toBytes(derived.project))
        } catch (error) {
          failed += 1
          notify('bad', `${job.label}：${error instanceof Error ? error.message : String(error)}`)
        }
      }
    } finally {
      if (applied) {
        setProgress('恢复参数')
        try {
          await restoreParameters()
        } catch (error) {
          notify('bad', error instanceof Error ? error.message : String(error))
        }
      }
    }
    setProgress(cancelExport.current ? `已取消，失败 ${failed} 个` : `完成，失败 ${failed} 个`)
  }

  const fileName = sourcePath ? sourcePath.split(/[/\\]/).pop() || '未打开工程' : '未打开工程'
  const hashOk = bridge ? bridge.sourceHash === bridge.installedHash : null

  return (
    <div className="flex h-full min-h-0 bg-canvas text-ink">
      <Sidebar
        view={view}
        partCount={parts.length}
        variantCount={project?.variants.length || 0}
        connected={Boolean(health)}
        documentName={health?.documentName || ''}
        bridgeVersion={bridge?.version || health?.version || ''}
        onView={setView}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar
          crumbs={[fileName, ...VIEW_CRUMBS[view]]}
          right={(
            <>
              <Button variant="outline" onClick={openSource}><FolderOpen className="size-3.5" />打开</Button>
              <Button variant="outline" disabled={!project} onClick={saveAs}>另存为</Button>
              <Button variant="secondary" onClick={createFromModel}><FilePlus2 className="size-3.5" />从当前模型新建</Button>
            </>
          )}
        />
        <div className="min-h-0 flex-1">
          {view === 'overview' && (
            <OverviewPage
              project={project}
              sourcePath={sourcePath}
              health={health}
              healthError={healthError}
              partCount={parts.length}
              variantCount={project?.variants.length || 0}
              onOpen={openSource}
              onCreate={createFromModel}
              onView={setView}
              onPrint={changePrint}
            />
          )}
          {view === 'parts' && (
            <PartsPage
              project={project}
              tree={partTree}
              selectedId={selectedPartId}
              selected={selected ? { subtype: selected.part.subtype, metadata: selected.part.metadata } : null}
              alignment={alignment}
              onSelect={setSelectedPartId}
              onSubtype={(subtype) => patchPart({}, subtype)}
              onMeta={(key, value) => patchPart({ [key]: value })}
              including={including}
              onInclude={includeNode}
              onExclude={excludeNode}
              onDelete={deletePart}
              onOpen={openSource}
              onCreate={createFromModel}
            />
          )}
          {view === 'variants' && (
            <VariantsPage
              ready={Boolean(project)}
              parameters={parameters}
              variants={project?.variants || []}
              onAdd={() => {
                if (!project) return
                const parametersSeed = Object.fromEntries(parameters.map((parameter) => [parameter.name, parameter.expression]))
                mark({ ...project, variants: [...project.variants, { name: `变体${project.variants.length + 1}`, parameters: parametersSeed }] })
              }}
              onRename={(index, name) => {
                if (!project) return
                mark({ ...project, variants: project.variants.map((variant, variantIndex) => variantIndex === index ? { ...variant, name } : variant) })
              }}
              onParam={(index, name, value) => {
                if (!project) return
                mark({
                  ...project,
                  variants: project.variants.map((variant, variantIndex) => variantIndex === index ? { ...variant, parameters: { ...variant.parameters, [name]: value } } : variant),
                })
              }}
              onCopy={(index) => {
                if (!project) return
                const source = project.variants[index]
                if (!source) return
                const variants = [...project.variants]
                variants.splice(index + 1, 0, { name: `${source.name} 副本`, parameters: { ...source.parameters } })
                mark({ ...project, variants })
              }}
              onDelete={(index) => {
                if (!project) return
                mark({ ...project, variants: project.variants.filter((_, variantIndex) => variantIndex !== index) })
              }}
              onOpen={openSource}
              onCreate={createFromModel}
            />
          )}
          {view === 'export' && (
            <ExportPage
              ready={Boolean(project)}
              parametersReady={parameters.length > 0}
              exportDir={project ? resolveExportDir(sourcePath, project.exportDir || DEFAULT_EXPORT_DIR) : ''}
              exportRelative={project?.exportDir || DEFAULT_EXPORT_DIR}
              originalFile={safeFileName(fileStem(sourcePath))}
              exportOriginal={exportOriginal}
              variants={project?.variants || []}
              selected={selectedVariants}
              progress={progress}
              onToggleOriginal={() => setExportOriginal((current) => !current)}
              onPickDir={async () => {
                if (!inShell()) {
                  notify('warn', '选择文件夹要在桌面程序里进行。')
                  return
                }
                const path = await invoke<string | null>('pick_dir')
                if (path) changeExportDir(path)
              }}
              onToggle={(name) => setSelectedVariants((current) => current.includes(name) ? current.filter((item) => item !== name) : [...current, name])}
              onToggleAll={() => {
                const names = parameters.length ? (project?.variants.map((variant) => variant.name) || []) : []
                const all = exportOriginal && names.every((name) => selectedVariants.includes(name))
                setExportOriginal(!all)
                setSelectedVariants(all ? [] : names)
              }}
              onExport={runExport}
              onCancel={() => { cancelExport.current = true }}
              onOpen={openSource}
              onCreate={createFromModel}
            />
          )}
          {view === 'link' && (
            <LinkPage
              health={health}
              healthError={healthError}
              dest={bridge?.dest || ''}
              hashText={inShell() ? '正在检测' : '桌面程序启动后会自动检测'}
              hashOk={hashOk}
              justCopied={justCopied}
              onSync={() => refreshBridge().then(refreshHealth).catch((error) => notify('bad', String(error)))}
            />
          )}
        </div>
      </div>
      <ToastList items={toasts} />
    </div>
  )
}
