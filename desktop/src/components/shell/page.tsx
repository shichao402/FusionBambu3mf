import type { ComponentProps, ReactNode } from 'react'
import { cn } from '@/lib/cn'

const container = 'mx-auto w-full max-w-[1440px]'

export const fitBlock = 'flex min-h-0 max-h-full flex-col overflow-hidden'

export function Page({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('flex h-full min-h-0 flex-col', className)} {...props} />
}

export function PageHeader({
  title,
  description,
  actions,
  meta,
}: {
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
  meta?: ReactNode
}) {
  return (
    <div className="shrink-0 px-8 pt-7 pb-5">
      <div className={cn(container, 'flex items-start justify-between gap-6')}>
        <div className="min-w-0">
          <h1 className="line-clamp-2 text-[22px] leading-7 font-semibold tracking-tight text-ink">{title}</h1>
          {description && <p className="mt-1.5 text-[13px] leading-relaxed text-faint">{description}</p>}
          {meta && <div className="mt-2 flex flex-wrap items-center gap-2">{meta}</div>}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
    </div>
  )
}

export function PageScroll({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-8 pb-8">
      <div className={cn(container, className)}>{children}</div>
    </div>
  )
}

export function PageFill({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-8 pb-8">
      <div className={cn(container, 'flex min-h-0 flex-1 flex-col', className)}>{children}</div>
    </div>
  )
}

export function SplitPane({ children, rail }: { children: ReactNode; rail: ReactNode }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 xl:grid xl:grid-cols-[minmax(0,1fr)_22rem] xl:overflow-hidden">
      <div className="flex min-h-0 flex-col">{children}</div>
      <div className="flex min-h-0 flex-col">{rail}</div>
    </div>
  )
}
