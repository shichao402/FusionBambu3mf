import type { ComponentProps, ReactNode } from 'react'
import { ChevronRight } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/cn'

export function NavCardGrid({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('grid shrink-0 gap-3 sm:grid-cols-2 xl:grid-cols-3', className)} {...props} />
}

export function NavCard({
  icon: Icon,
  title,
  description,
  meta,
  onClick,
}: {
  icon: LucideIcon
  title: string
  description: string
  meta?: ReactNode
  onClick: () => void
}) {
  return (
    <button type="button" onClick={onClick} className="group flex min-w-0 items-start gap-3 rounded-xl border border-line bg-panel px-4 py-3.5 text-left transition-colors hover:border-line-hi hover:bg-panel-hi">
      <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-accent/15 text-accent-hi">
        <Icon className="size-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="min-w-0 truncate text-[13px] font-medium text-ink" title={title}>{title}</span>
          {meta}
        </span>
        <span className="mt-0.5 block text-xs leading-relaxed text-faint">{description}</span>
      </span>
      <ChevronRight className="mt-1 size-4 shrink-0 text-line-hi transition-colors group-hover:text-faint" />
    </button>
  )
}
