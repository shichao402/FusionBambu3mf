import { Button } from '@/components/ui/button'
import { KeyValue, Notice } from '@/components/ui/feedback'
import { Panel, PanelBody, PanelFooter, PanelHeader } from '@/components/ui/panel'
import { Page, PageHeader, PageScroll } from '@/components/shell/page'
import type { Health } from '@/bridge'

export function LinkPage(props: {
  health: Health | null
  healthError: string
  dest: string
  hashText: string
  hashOk: boolean | null
  justCopied: boolean
  onSync: () => void
}) {
  return (
    <Page>
      <PageHeader title="Fusion" description="桥会在启动时复制到 Fusion 插件目录。这里只看状态，不用改配置文件。" />
      <PageScroll>
        <Panel>
          <PanelHeader title="连接" />
          <PanelBody className="space-y-3">
            {props.health ? (
              <Notice tone="info" text={`已连接 ${props.health.documentName || '无文档'}，桥版本 ${props.health.version}`} />
            ) : (
              <Notice tone="warn" text={props.healthError || '未连接。请先打开 Fusion，桥加载后会自动出现。'} />
            )}
            {props.justCopied && !props.health && <Notice tone="info" text="插件已复制到 Fusion。请重启 Fusion 后再回来。" />}
            <KeyValue label="插件目录" value={props.dest || '检测后显示'} mono />
            <KeyValue label="桥文件" value={props.hashOk === null ? props.hashText : props.hashOk ? '已一致' : '不一致，点下面的按钮会重新复制'} />
          </PanelBody>
          <PanelFooter>
            <Button variant="accent" onClick={props.onSync}>检测并释放桥</Button>
          </PanelFooter>
        </Panel>
      </PageScroll>
    </Page>
  )
}
