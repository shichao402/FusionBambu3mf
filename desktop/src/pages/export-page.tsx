import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { EmptyState, Notice } from '@/components/ui/feedback'
import { Panel, PanelFooter, PanelHeader } from '@/components/ui/panel'
import { Page, PageHeader, PageScroll } from '@/components/shell/page'
import type { VariantRecord } from '../../threemf/package'

export function ExportPage(props: {
  ready: boolean
  parametersReady: boolean
  exportDir: string
  exportRelative: string
  originalFile: string
  exportOriginal: boolean
  variants: VariantRecord[]
  selected: string[]
  progress: string
  onPickDir: () => void
  onToggleOriginal: () => void
  onToggle: (name: string) => void
  onToggleAll: () => void
  onExport: () => void
  onCancel: () => void
  onOpen: () => void
  onCreate: () => void
}) {
  const variantNames = props.parametersReady ? props.variants.map((variant) => variant.name) : []
  const all = props.exportOriginal && variantNames.every((name) => props.selected.includes(name))
  const canExport = props.exportOriginal || (props.parametersReady && props.selected.length > 0)
  return (
    <Page>
      <PageHeader title="导出" description="用当前工程里的零件和层级，套上当时的 Fusion 网格。原始模型不改变体参数。文件写到工程旁边的文件夹，不覆盖源工程。" />
      <PageScroll>
        {!props.ready ? (
          <EmptyState text="先打开工程" hint="导出使用当前工程里已经纳入的零件，再套上原始模型或变体参数。" action={<><Button onClick={props.onOpen}>打开</Button><Button variant="accent" onClick={props.onCreate}>从当前模型新建</Button></>} />
        ) : (
          <div className="space-y-4">
            {!props.parametersReady && <Notice text="当前设计没有标星参数，只能导出原始模型。" />}
            <Panel>
              <PanelHeader
                title="导出目录"
                description={`${props.exportDir}（${props.exportRelative}）`}
                action={<Button variant="outline" onClick={props.onPickDir}>选择文件夹</Button>}
              />
              <div className="overflow-x-auto">
                <table className="w-full text-left text-[13px]">
                  <thead className="text-[11px] tracking-wide text-faint uppercase">
                    <tr>
                      <th className="w-12 px-4 py-2 font-medium">
                        <Checkbox checked={all} aria-label="全选" onChange={props.onToggleAll} />
                      </th>
                      <th className="px-4 py-2 font-medium">名称</th>
                      <th className="px-4 py-2 font-medium">文件</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="border-t border-line">
                      <td className="px-4 py-2"><Checkbox checked={props.exportOriginal} aria-label="原始模型" onChange={props.onToggleOriginal} /></td>
                      <td className="px-4 py-2 text-ink">原始模型</td>
                      <td className="px-4 py-2 text-muted">{props.originalFile}</td>
                    </tr>
                    {props.variants.map((variant) => (
                      <tr key={variant.name} className="border-t border-line">
                        <td className="px-4 py-2">
                          <Checkbox checked={props.parametersReady && props.selected.includes(variant.name)} aria-label={variant.name} disabled={!props.parametersReady} onChange={() => props.onToggle(variant.name)} />
                        </td>
                        <td className="px-4 py-2 text-ink">{variant.name}</td>
                        <td className="px-4 py-2 text-muted">{`${variant.name}.3mf`.replace(/[<>:"/\\|?*]/g, '_')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <PanelFooter>
                <Button variant="accent" disabled={!canExport} onClick={props.onExport}>导出</Button>
                <Button variant="outline" onClick={props.onCancel}>取消</Button>
                {props.progress && <span className="text-xs text-faint">{props.progress}</span>}
              </PanelFooter>
            </Panel>
          </div>
        )}
      </PageScroll>
    </Page>
  )
}
