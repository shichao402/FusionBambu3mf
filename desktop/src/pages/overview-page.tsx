import { Boxes, Download, SlidersHorizontal } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { EmptyState, KeyValue, Notice, Stat } from '@/components/ui/feedback'
import { Field, Select } from '@/components/ui/input'
import { NavCard, NavCardGrid } from '@/components/ui/nav-card'
import { Panel, PanelBody, PanelHeader } from '@/components/ui/panel'
import { Page, PageHeader, PageScroll } from '@/components/shell/page'
import type { View } from '@/lib/views'
import type { Health } from '@/bridge'
import type { Project3mf } from '../../threemf/package'
import { printChoice } from '../../threemf/package'
import { BED_TYPES, PRINTERS, filamentsFor, processesFor, type FilamentPreset, type PrintPatch } from '../../threemf/presets'

function withCurrent(options: string[], current: string): string[] {
  if (!current || options.includes(current)) return options
  return [current, ...options]
}

function filamentGroups(filaments: FilamentPreset[], current: string): Array<[string, FilamentPreset[]]> {
  const rows = current && !filaments.some((filament) => filament.id === current)
    ? [{ id: current, type: '当前', vendor: '', filamentId: '', printers: [] }, ...filaments]
    : filaments
  const groups = new Map<string, FilamentPreset[]>()
  for (const filament of rows) {
    const list = groups.get(filament.type) ?? []
    list.push(filament)
    groups.set(filament.type, list)
  }
  return [...groups]
}

export function OverviewPage(props: {
  project: Project3mf | null
  sourcePath: string
  health: Health | null
  healthError: string
  partCount: number
  variantCount: number
  onOpen: () => void
  onCreate: () => void
  onView: (view: View) => void
  onPrint: (patch: PrintPatch) => void
}) {
  const choice = props.project ? printChoice(props.project) : null
  const printers = choice ? withCurrent(PRINTERS.map((printer) => printer.id), choice.printerId) : []
  const processes = choice ? withCurrent(processesFor(choice.printerId), choice.processId) : []
  const filaments = choice ? filamentsFor(choice.printerId) : []
  const beds = choice ? withCurrent([...BED_TYPES], choice.bed) : []
  return (
    <Page>
      <PageHeader
        title="概览"
        description="零件、变体、打印预设和导出都在这个程序里改，并自动写回当前工程。"
      />
      <PageScroll className="space-y-4">
        {!props.health && <Notice tone="warn" text={props.healthError || '还没连上 Fusion。打开 Fusion 后，桥会自动接上。'} />}
        {!props.project ? (
          <EmptyState
            text="还没有工程"
            hint="打开一份已有的 3MF，或从当前 Fusion 模型新建。新建后每个零件都单独列出。"
            action={(
              <>
                <Button onClick={props.onOpen}>打开</Button>
                <Button variant="accent" onClick={props.onCreate}>从当前模型新建</Button>
              </>
            )}
          />
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <Stat label="Fusion" value={props.health?.documentName || '未连接'} tone={props.health ? 'good' : 'warn'} />
              <Stat label="零件" value={String(props.partCount)} detail="与 Fusion 网格一一对应" />
              <Stat label="变体" value={String(props.variantCount)} detail="标星参数的一组取值" />
              <Stat label="工程" value={props.sourcePath.split(/[/\\]/).pop() || '未命名'} detail="改动会写回这个文件" />
            </div>
            <NavCardGrid>
              <NavCard icon={Boxes} title="零件" description="零件类型、壳体层数、稀疏填充" onClick={() => props.onView('parts')} />
              <NavCard icon={SlidersHorizontal} title="变体" description="按标星参数排一组尺寸" onClick={() => props.onView('variants')} />
              <NavCard icon={Download} title="导出" description="写出原始模型和各个变体" onClick={() => props.onView('export')} />
            </NavCardGrid>
            <Panel>
              <PanelHeader title="当前工程" description={props.sourcePath} />
              <PanelBody className="space-y-4">
                <KeyValue label="路径" value={props.sourcePath} mono />
                {choice?.editable ? (
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="打印机" hint="选项来自 Bambu Studio 的系统预设。写入的是预设名称，打开时由已安装的 Bambu Studio 套用。">
                      <Select value={choice.printerId} onChange={(event) => props.onPrint({ printerId: event.target.value })}>
                        {printers.map((id) => <option key={id} value={id}>{id}</option>)}
                      </Select>
                    </Field>
                    <Field label="工艺">
                      <Select value={choice.processId} onChange={(event) => props.onPrint({ processId: event.target.value })}>
                        {processes.map((id) => <option key={id} value={id}>{id}</option>)}
                      </Select>
                    </Field>
                    <Field label="耗材" hint={choice.filamentCount > 1 ? `这份工程里有 ${choice.filamentCount} 种耗材。改选后会改成上面这一种。` : undefined}>
                      <Select value={choice.filamentId} onChange={(event) => props.onPrint({ filamentId: event.target.value })}>
                        {filamentGroups(filaments, choice.filamentId).map(([type, rows]) => (
                          <optgroup key={type} label={type}>
                            {rows.map((filament) => <option key={filament.id} value={filament.id}>{filament.id}</option>)}
                          </optgroup>
                        ))}
                      </Select>
                    </Field>
                    <Field label="热床">
                      <Select value={choice.bed} onChange={(event) => props.onPrint({ bed: event.target.value })}>
                        {beds.map((id) => <option key={id} value={id}>{id}</option>)}
                      </Select>
                    </Field>
                  </div>
                ) : (
                  <Notice tone="info" text="这份工程有多个喷嘴，程序会原样保留。" />
                )}
              </PanelBody>
            </Panel>
          </>
        )}
      </PageScroll>
    </Page>
  )
}
