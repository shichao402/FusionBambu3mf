import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/feedback'
import { Field, Input, Select } from '@/components/ui/input'
import { Panel, PanelBody, PanelHeader } from '@/components/ui/panel'
import { Page, PageFill, PageHeader, SplitPane, fitBlock } from '@/components/shell/page'
import { cn } from '@/lib/cn'
import { PART_TYPES, patternOptions, subtypeLabel } from '@/bambuLabels'
import type { Project3mf } from '../../threemf/package'

export type AlignRow = { key: string; status: string; label: string; meshName: string; path?: string; partId?: string }

type PartNode = { key: string; title: string; children?: { key: string; title: string }[] }

export function PartsPage(props: {
  project: Project3mf | null
  tree: PartNode[]
  selectedId: string
  selected: { subtype: string; metadata: Record<string, string> } | null
  alignment: AlignRow[]
  onSelect: (id: string) => void
  onSubtype: (subtype: string) => void
  onMeta: (key: string, value: string) => void
  including?: string
  onInclude: (path: string, meshName: string) => void
  onExclude: (path: string, partId: string) => void
  onDelete: (partId: string) => void
  onOpen: () => void
  onCreate: () => void
}) {
  return (
    <Page>
      <PageHeader title="零件" description="每个 Fusion 网格是 Bambu Studio 里的一个零件，不再收成一个复合零件。" />
      <PageFill>
        {!props.project ? (
          <EmptyState text="先打开工程" hint="打开或新建之后，零件和打印设置会出现在这里。" action={<><Button onClick={props.onOpen}>打开</Button><Button variant="accent" onClick={props.onCreate}>从当前模型新建</Button></>} />
        ) : (
          <div className="flex min-h-0 flex-1 flex-col gap-4">
            <SplitPane
              rail={(
                <Panel className={fitBlock}>
                  <PanelHeader title="打印设置" description={props.selected ? subtypeLabel(props.selected.subtype) : '选择左侧零件'} />
                  <PanelBody>
                    {props.selected ? (
                      <div className="space-y-4">
                        <Field label="零件类型">
                          <Select value={props.selected.subtype} onChange={(event) => props.onSubtype(event.target.value)}>
                            {PART_TYPES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                          </Select>
                        </Field>
                        <Field label="顶部壳体层数">
                          <Input type="number" min={0} value={props.selected.metadata.top_shell_layers || ''} onChange={(event) => props.onMeta('top_shell_layers', event.target.value)} />
                        </Field>
                        <Field label="底部壳体层数">
                          <Input type="number" min={0} value={props.selected.metadata.bottom_shell_layers || ''} onChange={(event) => props.onMeta('bottom_shell_layers', event.target.value)} />
                        </Field>
                        <Field label="稀疏填充密度" hint="例如 15%">
                          <Input placeholder="15%" value={props.selected.metadata.sparse_infill_density || ''} onChange={(event) => props.onMeta('sparse_infill_density', event.target.value)} />
                        </Field>
                        <Field label="稀疏填充图案">
                          <Select value={props.selected.metadata.sparse_infill_pattern || ''} onChange={(event) => props.onMeta('sparse_infill_pattern', event.target.value)}>
                            <option value="">跟随工程</option>
                            {patternOptions(props.selected.metadata.sparse_infill_pattern).map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                          </Select>
                        </Field>
                      </div>
                    ) : <p className="text-[13px] text-faint">选择左侧的零件。</p>}
                  </PanelBody>
                </Panel>
              )}
            >
              <Panel className={cn(fitBlock, 'min-h-48')}>
                <PanelHeader title="对象与零件" />
                <div className="min-h-0 flex-1 overflow-y-auto p-2">
                  {props.tree.map((node) => (
                    node.children ? (
                      <div key={node.key} className="mb-2">
                        <div className="px-2 py-1 text-[11px] font-medium tracking-wide text-faint">{node.title}</div>
                        {node.children.map((child) => (
                          <PartButton key={child.key} title={child.title} active={props.selectedId === child.key} onClick={() => props.onSelect(child.key)} />
                        ))}
                      </div>
                    ) : (
                      <PartButton key={node.key} title={node.title} active={props.selectedId === node.key} onClick={() => props.onSelect(node.key)} />
                    )
                  ))}
                </div>
              </Panel>
            </SplitPane>
            <Panel>
              <PanelHeader title="和 Fusion 对表" description="纳入的零件记在这份 3MF 里，移出后导出就不再带着它。" />
              <div className="overflow-x-auto">
                <table className="w-full text-left text-[13px]">
                  <thead className="text-[11px] tracking-wide text-faint uppercase">
                    <tr>
                      <th className="px-4 py-2 font-medium">状态</th>
                      <th className="px-4 py-2 font-medium">路径</th>
                      <th className="px-4 py-2 font-medium">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {props.alignment.length === 0 && (
                      <tr><td className="px-4 py-6 text-faint" colSpan={3}>连上 Fusion 后这里会列出零件。</td></tr>
                    )}
                    {props.alignment.map((row) => (
                      <tr key={row.key} className="border-t border-line">
                        <td className="px-4 py-2"><Badge tone={row.status === '已对齐' ? 'good' : row.status === '仅 Fusion 有' ? 'warn' : 'neutral'}>{row.status}</Badge></td>
                        <td className="max-w-[28rem] truncate px-4 py-2 text-muted" title={row.label}>{row.label}</td>
                        <td className="px-4 py-2">
                          {row.status === '已对齐' && row.path && row.partId && (
                            <Button size="sm" variant="outline" disabled={Boolean(props.including)} onClick={() => props.onExclude(row.path || '', row.partId || '')}>移出</Button>
                          )}
                          {row.status === '仅 Fusion 有' && (
                            <Button size="sm" variant="outline" disabled={Boolean(props.including)} onClick={() => props.onInclude(row.path || row.label, row.meshName)}>
                              {props.including === row.path ? '纳入中' : '纳入'}
                            </Button>
                          )}
                          {row.status === '仅工程有' && row.partId && <Button size="sm" variant="destructive" onClick={() => props.onDelete(row.partId || '')}>删除</Button>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>
          </div>
        )}
      </PageFill>
    </Page>
  )
}

function PartButton({ title, active, onClick }: { title: string; active: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className={cn('flex h-9 w-full items-center rounded-lg px-2 text-left text-[13px]', active ? 'bg-panel-hi font-medium text-ink' : 'text-muted hover:bg-panel-hi hover:text-ink')}>
      <span className="truncate" title={title}>{title}</span>
    </button>
  )
}
