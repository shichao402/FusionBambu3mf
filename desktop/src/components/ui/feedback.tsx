import type { ReactNode } from 'react'
import { Inbox, LoaderCircle, TriangleAlert } from 'lucide-react'
import { cn } from '@/lib/cn'

export function Stat({
  label,
  value,
  detail,
  tone,
}: {
  label: string
  value: string
  detail?: ReactNode
  tone?: 'good' | 'warn' | 'bad'
}) {
  const valueColor = tone === 'good' ? 'text-good' : tone === 'warn' ? 'text-warn' : tone === 'bad' ? 'text-bad' : 'text-ink'
  return (
    <div className="min-w-0 rounded-xl border border-line bg-panel px-4 py-3">
      <div className="text-[11px] font-medium tracking-wide text-faint uppercase">{label}</div>
      <div className={cn('tnum mt-1 truncate text-lg font-semibold', valueColor)}>{value}</div>
      {detail && <div className="mt-0.5 truncate text-xs text-faint">{detail}</div>}
    </div>
  )
}

export function EmptyState({
  text,
  hint,
  icon,
  action,
  className,
}: {
  text: string
  hint?: string
  icon?: ReactNode
  action?: ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex min-h-56 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-line px-6 py-10 text-center', className)}>
      <div className="text-faint">{icon || <Inbox className="size-5" />}</div>
      <div className="text-[13px] text-muted">{text}</div>
      {hint && <div className="max-w-md text-xs leading-relaxed text-faint">{hint}</div>}
      {action && <div className="mt-2 flex flex-wrap items-center justify-center gap-2">{action}</div>}
    </div>
  )
}

export function Notice({
  text,
  tone = 'warn',
  className,
}: {
  text: ReactNode
  tone?: 'warn' | 'bad' | 'info'
  className?: string
}) {
  const style = tone === 'bad'
    ? 'border-bad/40 bg-bad/10 text-bad'
    : tone === 'info'
      ? 'border-accent/35 bg-accent/10 text-accent-hi'
      : 'border-warn/35 bg-warn/10 text-warn'
  return (
    <div className={cn('flex gap-2 rounded-lg border px-3 py-2 text-xs leading-relaxed', style, className)}>
      <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
      <div className="min-w-0">{text}</div>
    </div>
  )
}

export function KeyValue({ label, value, mono }: { label: string; value: ReactNode; mono?: boolean }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-3">
      <div className="w-28 shrink-0 text-xs text-faint">{label}</div>
      <div className={cn('min-w-0 flex-1 text-[13px] break-all text-muted', mono && 'font-mono text-xs')} title={typeof value === 'string' ? value : undefined}>{value}</div>
    </div>
  )
}

export function ToastList({ items }: { items: { id: number; tone: 'good' | 'bad' | 'warn'; text: string }[] }) {
  if (!items.length) return null
  return (
    <div className="pointer-events-none fixed right-4 bottom-4 z-50 flex w-80 flex-col gap-2">
      {items.map((item) => (
        <div
          key={item.id}
          className={cn(
            'rounded-lg border px-3 py-2 text-xs leading-relaxed shadow-lg',
            item.tone === 'bad' ? 'border-bad/40 bg-panel text-bad' : item.tone === 'warn' ? 'border-warn/40 bg-panel text-warn' : 'border-good/40 bg-panel text-good',
          )}
        >
          {item.text}
        </div>
      ))}
    </div>
  )
}

export function Busy({ text }: { text: string }) {
  return (
    <span className="flex items-center gap-1.5 rounded-full border border-accent/30 bg-accent/10 px-2.5 py-1 text-xs text-accent-hi">
      <LoaderCircle className="size-3.5 animate-spin" />
      {text}
    </span>
  )
}
