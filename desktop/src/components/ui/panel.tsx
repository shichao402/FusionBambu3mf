import type { ComponentProps, ReactNode } from 'react'
import { cn } from '@/lib/cn'

export function Panel({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('rounded-xl border border-line bg-panel', className)} {...props} />
}

export function PanelHeader({
  title,
  description,
  action,
  className,
}: {
  title: ReactNode
  description?: ReactNode
  action?: ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex items-start justify-between gap-3 border-b border-line px-4 py-3', className)}>
      <div className="min-w-0">
        <div className="text-[13px] font-semibold text-ink">{title}</div>
        {description && <div className="mt-0.5 text-xs text-faint">{description}</div>}
      </div>
      {action}
    </div>
  )
}

export function PanelBody({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('p-4', className)} {...props} />
}

export function PanelFooter({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('flex flex-wrap items-center gap-3 border-t border-line px-4 py-3', className)} {...props} />
}
