import type { LucideIcon } from 'lucide-react'
import { Boxes, Cable, Download, LayoutDashboard, SlidersHorizontal } from 'lucide-react'
import { StatusDot } from '@/components/ui/badge'
import { cn } from '@/lib/cn'
import type { View } from '@/lib/views'

type NavItem = { id: View; label: string; icon: LucideIcon; count?: number }

export function Sidebar(props: {
  view: View
  partCount: number
  variantCount: number
  connected: boolean
  documentName: string
  bridgeVersion: string
  onView: (view: View) => void
}) {
  const groups: { label: string; items: NavItem[] }[] = [
    {
      label: '工作区',
      items: [
        { id: 'overview', label: '概览', icon: LayoutDashboard },
        { id: 'parts', label: '零件', icon: Boxes, count: props.partCount },
        { id: 'variants', label: '变体', icon: SlidersHorizontal, count: props.variantCount },
        { id: 'export', label: '导出', icon: Download },
      ],
    },
    { label: '连接', items: [{ id: 'link', label: 'Fusion', icon: Cable }] },
  ]

  return (
    <aside className="flex w-[240px] shrink-0 flex-col border-r border-line bg-surface">
      <div className="flex h-14 shrink-0 items-center gap-2.5 border-b border-line px-4">
        <span className="grid size-7 place-items-center rounded-lg bg-accent/15 text-accent-hi">
          <Boxes className="size-4" />
        </span>
        <span className="min-w-0 truncate text-[13px] font-semibold tracking-tight">FusionBambu3mf</span>
      </div>
      <nav className="min-h-0 flex-1 space-y-4 overflow-y-auto p-2.5">
        {groups.map((group) => (
          <div key={group.label}>
            <div className="mb-1 px-1.5 text-[11px] font-medium tracking-wide text-faint uppercase">{group.label}</div>
            <div className="space-y-0.5">
              {group.items.map((item) => {
                const Icon = item.icon
                const active = props.view === item.id
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => props.onView(item.id)}
                    className={cn(
                      'flex h-9 w-full items-center gap-2.5 rounded-lg px-2 text-[13px] transition-colors',
                      active ? 'bg-panel-hi font-medium text-ink' : 'text-muted hover:bg-panel-hi hover:text-ink',
                    )}
                  >
                    <Icon className={cn('size-4 shrink-0', active ? 'text-accent-hi' : 'text-faint')} />
                    <span className="min-w-0 flex-1 truncate text-left">{item.label}</span>
                    {item.count ? <span className="tnum text-[11px] text-faint">{item.count}</span> : null}
                  </button>
                )
              })}
            </div>
          </div>
        ))}
      </nav>
      <div className="shrink-0 space-y-1 border-t border-line p-3">
        <div className="flex items-center gap-2 px-1.5 text-[12px]">
          <StatusDot tone={props.connected ? 'good' : 'warn'} />
          <span className="min-w-0 flex-1 truncate text-muted" title={props.documentName}>{props.connected ? props.documentName || '已连接' : '未连接 Fusion'}</span>
        </div>
        <div className="flex items-center justify-between px-1.5 text-[11px] text-faint">
          <span>桥</span>
          <span className="font-mono">{props.bridgeVersion || '—'}</span>
        </div>
      </div>
    </aside>
  )
}
