import {
  Alert,
  Button,
  Form,
  Input,
  InputNumber,
  Layout,
  Modal,
  Select,
  Space,
  Table,
  Tabs,
  Typography,
  message,
} from 'antd'
import { invoke } from '@tauri-apps/api/core'
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
} from './bridge'
import {
  createFromFusionMesh,
  dropPartsNamed,
  includeFusionMesh,
  listParts,
  mergeFusionMesh,
  readProject,
  removePart,
  toBytes,
  updatePart,
  type Project3mf,
  type VariantRecord,
} from '../threemf/package'

const PATTERNS = ['grid', 'gyroid', 'honeycomb', 'rectilinear', 'triangles', 'cubic', 'concentric']

type BridgeStatus = {
  sourceHash: string
  installedHash: string
  dest: string
  copied: boolean
  version: string
}

const { Header, Content } = Layout

function flatten(nodes: StructureNode[]): StructureNode[] {
  return nodes.flatMap((node) => [node, ...flatten(node.children)])
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
  const [dirty, setDirty] = useState(false)
  const [selectedPartId, setSelectedPartId] = useState('')
  const [exportDir, setExportDir] = useState('')
  const [selectedVariants, setSelectedVariants] = useState<string[]>([])
  const [progress, setProgress] = useState('')
  const [justCopied, setJustCopied] = useState(false)
  const cancelExport = useRef(false)

  const refreshBridge = useCallback(async () => {
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
    refreshBridge().catch((error) => message.error(String(error)))
    const timer = window.setInterval(() => {
      refreshHealth().catch(() => undefined)
    }, 3000)
    refreshHealth().catch(() => undefined)
    return () => window.clearInterval(timer)
  }, [refreshBridge, refreshHealth])

  const parts = useMemo(() => (project ? listParts(project) : []), [project])
  const selected = parts.find((item) => item.part.id === selectedPartId)
  const alignment = useMemo(() => {
    const bodies = flatten(structure).filter((node) => node.kind === 'body')
    const leaves = bodies.length ? bodies : flatten(structure).filter((node) => node.kind === 'component')
    const used = new Set<string>()
    const rows: { key: string; status: string; label: string; meshName: string; partId?: string }[] = []
    leaves.forEach((node) => {
      const last = node.path.split('/').pop() || node.name
      const keys = [...new Set([last, last.replace(/:\d+$/, ''), node.name, node.componentName].filter(Boolean))]
      const part = parts.find((row) => keys.includes(row.part.metadata.name || ''))
      if (part) {
        used.add(part.part.id)
        rows.push({ key: `both-${node.path}`, status: '两边都有', label: node.path, meshName: part.part.metadata.name || '', partId: part.part.id })
      } else {
        rows.push({
          key: `fusion-${node.path}`,
          status: '仅模型有',
          label: node.path,
          meshName: (node.componentName || node.name).replace(/:\d+$/, ''),
        })
      }
    })
    parts.forEach((row) => {
      if (used.has(row.part.id)) return
      rows.push({
        key: `3mf-${row.part.id}`,
        status: '仅 3MF 有',
        label: row.part.metadata.name || row.part.id,
        meshName: row.part.metadata.name || '',
        partId: row.part.id,
      })
    })
    return rows
  }, [parts, structure])

  function mark(next: Project3mf) {
    setProject(next)
    setDirty(true)
  }

  function confirmDiscard(): Promise<boolean> {
    if (!dirty) return Promise.resolve(true)
    return new Promise((resolve) => {
      Modal.confirm({
        title: '源 3MF 有未保存的修改',
        content: '重新加载会丢掉界面上的修改。',
        okText: '丢弃并重新加载',
        cancelText: '取消',
        onOk: () => resolve(true),
        onCancel: () => resolve(false),
      })
    })
  }

  async function openSource() {
    if (!(await confirmDiscard())) return
    const path = await invoke<string | null>('pick_open')
    if (!path) return
    const loaded = readProject(await readPath(path))
    setSourcePath(path)
    setProject(loaded)
    setDirty(false)
    setSelectedPartId(loaded.objects[0]?.parts[0]?.id || '')
    setSelectedVariants(loaded.variants.map((variant) => variant.name))
  }

  async function saveSource(target = sourcePath) {
    if (!project || !target) return
    const bak = `${target}.bak`
    try {
      await writePath(bak, await readPath(target))
    } catch {
      // 新文件还没有可备份的内容。
    }
    await writePath(target, toBytes(project))
    setSourcePath(target)
    setDirty(false)
    message.success('已写回源 3MF')
  }

  async function saveAs() {
    const path = await invoke<string | null>('pick_save')
    if (!path || !project) return
    await saveSource(path)
  }

  async function createFromModel() {
    if (!(await confirmDiscard())) return
    if (!health?.hasDesign) {
      message.warning('先连接 Fusion')
      return
    }
    const path = await invoke<string | null>('pick_save')
    if (!path) return
    const exported = await exportMesh()
    const created = createFromFusionMesh(await readPath(exported.path), health.documentName || '未命名')
    setProject(created)
    setSourcePath(path)
    setDirty(true)
    setSelectedPartId(created.objects[0]?.parts[0]?.id || '')
    await saveSource(path)
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
      objects: next.objects.map((objectNode) => ({ ...objectNode, parts: objectNode.parts.map((part) => ({ ...part, metadata: { ...part.metadata } })) })),
    })
  }

  async function includeNode(meshName: string) {
    if (!project || !health?.hasDesign) {
      message.warning('先连接 Fusion')
      return
    }
    const mesh = await exportMesh()
    includeFusionMesh(project, await readPath(mesh.path), meshName)
    refreshProject(project)
  }

  function deletePart(partId: string) {
    if (!project) return
    removePart(project, partId)
    if (selectedPartId === partId) setSelectedPartId('')
    refreshProject(project)
  }

  async function runExport() {
    if (!project || !sourcePath || !exportDir) {
      message.warning('需要源 3MF 和导出目录')
      return
    }
    if (dirty) await saveSource()
    const rows = project.variants.filter((variant) => selectedVariants.includes(variant.name))
    if (!rows.length) {
      message.warning('没有要导出的变体')
      return
    }
    let failed = 0
    let applied = false
    cancelExport.current = false
    try {
      for (let index = 0; index < rows.length; index += 1) {
        if (cancelExport.current) break
        const variant = rows[index]
        setProgress(`${variant.name}：套参数`)
        try {
          await applyParameters(variant.parameters, !applied)
          applied = true
          setProgress(`${variant.name}：导出网格`)
          const mesh = await exportMesh()
          const merged = mergeFusionMesh(readProject(await readPath(sourcePath)), await readPath(mesh.path))
          if (merged.failed.length) throw new Error(`网格没有对上：${merged.failed.join('、')}`)
          dropPartsNamed(merged.project, merged.missing)
          const filename = `${variant.name}.3mf`.replace(/[<>:"/\\|?*]/g, '_')
          setProgress(`${variant.name}：合并并写入`)
          await writePath(`${exportDir}\\${filename}`, toBytes(merged.project))
        } catch (error) {
          failed += 1
          message.error(`${variant.name}：${error instanceof Error ? error.message : String(error)}`)
        }
      }
    } finally {
      if (applied) {
        setProgress('恢复参数')
        try {
          await restoreParameters()
        } catch (error) {
          message.error(error instanceof Error ? error.message : String(error))
        }
      }
    }
    setProgress(cancelExport.current ? `已取消，失败 ${failed} 个` : `完成，失败 ${failed} 个`)
  }

  const variantColumns = [
    { title: '名称', dataIndex: 'name', render: (_: string, _row: VariantRecord, index: number) => (
      <Input value={project?.variants[index]?.name} onChange={(event) => {
        if (!project) return
        const variants = project.variants.map((variant, variantIndex) => variantIndex === index ? { ...variant, name: event.target.value } : variant)
        mark({ ...project, variants })
      }} />
    ) },
    ...parameters.map((parameter) => ({
      title: parameter.comment ? `${parameter.name}（${parameter.comment}）` : parameter.name,
      dataIndex: parameter.name,
      render: (_: string, _row: VariantRecord, index: number) => (
        <Input value={project?.variants[index]?.parameters[parameter.name] || ''} onChange={(event) => {
          if (!project) return
          const variants = project.variants.map((variant, variantIndex) => {
            if (variantIndex !== index) return variant
            return { ...variant, parameters: { ...variant.parameters, [parameter.name]: event.target.value } }
          })
          mark({ ...project, variants })
        }} />
      ),
    })),
    {
      title: '操作',
      render: (_: string, _row: VariantRecord, index: number) => (
        <Space>
          <Button size="small" onClick={() => {
            if (!project) return
            const source = project.variants[index]
            if (!source) return
            const variants = [...project.variants]
            variants.splice(index + 1, 0, { name: `${source.name} 副本`, parameters: { ...source.parameters } })
            mark({ ...project, variants })
          }}>复制</Button>
          <Button size="small" onClick={() => {
            if (!project) return
            mark({ ...project, variants: project.variants.filter((_, variantIndex) => variantIndex !== index) })
          }}>删除</Button>
        </Space>
      ),
    },
  ]

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Header style={{ color: 'white' }}>FusionBambu3mf {bridge?.version || ''}</Header>
      <Content style={{ padding: 16 }}>
        <Tabs items={[
          {
            key: 'link',
            label: '连接',
            children: (
              <Space direction="vertical" style={{ width: '100%' }}>
                {health ? <Alert type="success" message={`已连接 ${health.documentName || '无文档'}，桥版本 ${health.version}`} /> : <Alert type="warning" message={healthError || '未连接。请先打开 Fusion 并加载桥。'} />}
                {justCopied && !health ? <Alert type="info" message="插件已复制到 Fusion。请重启 Fusion。开发期可由 MCP 停止并重新运行桥。" /> : null}
                <Typography.Text>插件目录：{bridge?.dest || ''}</Typography.Text>
                <Typography.Text>hash {bridge && bridge.sourceHash === bridge.installedHash ? '已一致' : '不一致'} {bridge?.installedHash || ''}</Typography.Text>
                <Button onClick={() => refreshBridge().then(refreshHealth)}>检测并释放桥</Button>
              </Space>
            ),
          },
          {
            key: 'file',
            label: '源 3MF',
            children: (
              <Space direction="vertical">
                <Space>
                  <Button onClick={openSource}>打开</Button>
                  <Button onClick={createFromModel}>从当前模型新建</Button>
                  <Button onClick={() => saveSource()} disabled={!dirty}>保存</Button>
                  <Button onClick={saveAs} disabled={!project}>另存为</Button>
                </Space>
                <Typography.Text>{sourcePath || '未打开'}{dirty ? '（未保存）' : ''}</Typography.Text>
                <Typography.Paragraph>
                  {project?.files['Metadata/project_settings.config'] ? '已保留整份工程配置。' : '这份文件没有 project_settings。'}
                </Typography.Paragraph>
              </Space>
            ),
          },
          {
            key: 'parts',
            label: '零件',
            children: project ? (
              <Space direction="vertical" style={{ width: '100%' }}>
              <Space align="start">
                <Table
                  size="small"
                  rowKey={(row) => row.part.id}
                  dataSource={parts}
                  pagination={false}
                  onRow={(row) => ({ onClick: () => setSelectedPartId(row.part.id) })}
                  columns={[
                    { title: '对象', dataIndex: 'objectName' },
                    { title: '零件', render: (_, row) => row.part.metadata.name },
                    { title: '类型', render: (_, row) => row.part.subtype },
                  ]}
                />
                {selected ? (
                  <Form layout="vertical" style={{ width: 360 }}>
                    <Form.Item label="类型">
                      <Select
                        value={selected.part.subtype}
                        options={['normal_part', 'modifier_part', 'negative_part', 'support_enforcer', 'support_blocker'].map((value) => ({ value, label: value }))}
                        onChange={(subtype) => patchPart({}, subtype)}
                      />
                    </Form.Item>
                    <Form.Item label="顶层层数">
                      <InputNumber value={selected.part.metadata.top_shell_layers ? Number(selected.part.metadata.top_shell_layers) : null} onChange={(value) => patchPart({ top_shell_layers: value === null ? '' : String(value) })} />
                    </Form.Item>
                    <Form.Item label="底层层数">
                      <InputNumber value={selected.part.metadata.bottom_shell_layers ? Number(selected.part.metadata.bottom_shell_layers) : null} onChange={(value) => patchPart({ bottom_shell_layers: value === null ? '' : String(value) })} />
                    </Form.Item>
                    <Form.Item label="填充率">
                      <Input value={selected.part.metadata.sparse_infill_density || ''} onChange={(event) => patchPart({ sparse_infill_density: event.target.value })} />
                    </Form.Item>
                    <Form.Item label="填充图案">
                      <Select
                        value={selected.part.metadata.sparse_infill_pattern || undefined}
                        options={[...new Set([...PATTERNS, selected.part.metadata.sparse_infill_pattern].filter(Boolean))].map((value) => ({ value, label: value }))}
                        onChange={(pattern) => patchPart({ sparse_infill_pattern: pattern })}
                      />
                    </Form.Item>
                    <Typography.Paragraph type="secondary">
                      {Object.keys(selected.part.metadata).filter((key) => !['name', 'matrix', 'top_shell_layers', 'bottom_shell_layers', 'sparse_infill_density', 'sparse_infill_pattern'].includes(key)).join('、') || '没有其它键'}
                    </Typography.Paragraph>
                  </Form>
                ) : null}
              </Space>
              <Table
                size="small"
                rowKey="key"
                pagination={false}
                dataSource={alignment}
                columns={[
                  { title: '对表', dataIndex: 'status' },
                  { title: '路径', dataIndex: 'label' },
                  {
                    title: '操作',
                    render: (_, row) => {
                      if (row.status === '仅模型有') return <Button size="small" onClick={() => includeNode(row.meshName)}>纳入</Button>
                      if (row.status === '仅 3MF 有' && row.partId) return <Button size="small" onClick={() => deletePart(row.partId || '')}>删除</Button>
                      return null
                    },
                  },
                ]}
              />
              </Space>
            ) : <Alert type="info" message="先打开源 3MF" />,
          },
          {
            key: 'variants',
            label: '变体',
            children: (
              <Space direction="vertical" style={{ width: '100%' }}>
                {!parameters.length && <Alert type="warning" message="当前设计没有标星参数，不能导出变体。" />}
                <Button disabled={!project} onClick={() => {
                  if (!project) return
                  const parametersSeed = Object.fromEntries(parameters.map((parameter) => [parameter.name, parameter.expression]))
                  mark({ ...project, variants: [...project.variants, { name: `变体${project.variants.length + 1}`, parameters: parametersSeed }] })
                }}>增加变体</Button>
                <Table rowKey={(_, index) => String(index)} dataSource={project?.variants || []} columns={variantColumns} pagination={false} />
              </Space>
            ),
          },
          {
            key: 'export',
            label: '导出',
            children: (
              <Space direction="vertical">
                <Space>
                  <Button onClick={async () => setExportDir(await invoke<string | null>('pick_dir') || exportDir)}>选择导出目录</Button>
                  <Typography.Text>{exportDir}</Typography.Text>
                </Space>
                <Table
                  rowKey="name"
                  pagination={false}
                  dataSource={project?.variants || []}
                  rowSelection={{
                    selectedRowKeys: selectedVariants,
                    onChange: (keys) => setSelectedVariants(keys.map(String)),
                  }}
                  columns={[{ title: '变体', dataIndex: 'name' }]}
                />
                <Space>
                  <Button type="primary" disabled={!parameters.length} onClick={runExport}>批量导出</Button>
                  <Button onClick={() => { cancelExport.current = true }}>取消</Button>
                </Space>
                <Typography.Text>{progress}</Typography.Text>
              </Space>
            ),
          },
        ]} />
      </Content>
    </Layout>
  )
}
