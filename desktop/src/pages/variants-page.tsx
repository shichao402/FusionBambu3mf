import { Button } from '@/components/ui/button'
import { EmptyState, Notice } from '@/components/ui/feedback'
import { Input } from '@/components/ui/input'
import { Panel, PanelHeader } from '@/components/ui/panel'
import { Page, PageFill, PageHeader } from '@/components/shell/page'
import type { ParameterInfo } from '@/bridge'
import type { VariantRecord } from '../../threemf/package'

export function VariantsPage(props: {
  ready: boolean
  parameters: ParameterInfo[]
  variants: VariantRecord[]
  onAdd: () => void
  onRename: (index: number, name: string) => void
  onParam: (index: number, name: string, value: string) => void
  onCopy: (index: number) => void
  onDelete: (index: number) => void
  onOpen: () => void
  onCreate: () => void
}) {
  return (
    <Page>
      <PageHeader
        title="变体"
        description="每一行是一组标星参数。导出时按行套进 Fusion，再写出对应的 3MF。"
        actions={<Button variant="accent" disabled={!props.ready} onClick={props.onAdd}>添加变体</Button>}
      />
      <PageFill>
        {!props.ready ? (
          <EmptyState text="先打开工程" hint="变体保存在工程里，在这里增删即可。" action={<><Button onClick={props.onOpen}>打开</Button><Button variant="accent" onClick={props.onCreate}>从当前模型新建</Button></>} />
        ) : (
          <div className="flex min-h-0 flex-1 flex-col gap-3">
            {!props.parameters.length && <Notice text="当前设计没有标星参数，不能按变体导出。" />}
            <Panel className="flex min-h-0 flex-1 flex-col overflow-hidden">
              <PanelHeader title="参数表" description={props.parameters.length ? `${props.parameters.length} 个标星参数` : '等待 Fusion 标星参数'} />
              <div className="min-h-0 flex-1 overflow-auto">
                <table className="w-full min-w-max border-separate border-spacing-0 text-left text-[13px]">
                  <thead className="sticky top-0 bg-panel text-[11px] tracking-wide text-faint uppercase">
                    <tr>
                      <th className="border-b border-line px-3 py-2 font-medium">名称</th>
                      {props.parameters.map((parameter) => (
                        <th key={parameter.name} className="border-b border-line px-3 py-2 font-medium" title={parameter.comment || parameter.name}>{parameter.name}</th>
                      ))}
                      <th className="border-b border-line px-3 py-2 font-medium">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {props.variants.length === 0 && (
                      <tr><td className="px-3 py-8 text-faint" colSpan={props.parameters.length + 2}>还没有变体。添加一行后填写参数。</td></tr>
                    )}
                    {props.variants.map((variant, index) => (
                      <tr key={`${variant.name}-${index}`}>
                        <td className="border-b border-line px-3 py-2"><Input value={variant.name} onChange={(event) => props.onRename(index, event.target.value)} /></td>
                        {props.parameters.map((parameter) => (
                          <td key={parameter.name} className="border-b border-line px-3 py-2">
                            <Input className="w-36" title={parameter.comment || undefined} value={variant.parameters[parameter.name] || ''} onChange={(event) => props.onParam(index, parameter.name, event.target.value)} />
                          </td>
                        ))}
                        <td className="border-b border-line px-3 py-2">
                          <div className="flex gap-2">
                            <Button size="sm" variant="outline" onClick={() => props.onCopy(index)}>复制</Button>
                            <Button size="sm" variant="destructive" onClick={() => props.onDelete(index)}>删除</Button>
                          </div>
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
