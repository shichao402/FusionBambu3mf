import type { ReactNode } from 'react'
import { ChevronRight } from 'lucide-react'

export function TopBar({ crumbs, right }: { crumbs: string[]; right?: ReactNode }) {
  return (
    <header className="flex h-14 shrink-0 items-center gap-4 border-b border-line bg-canvas/85 px-5 backdrop-blur">
      <nav aria-label="位置" className="flex min-w-0 items-center gap-1">
        {crumbs.map((crumb, index) => (
          <span key={`${crumb}-${index}`} className="flex min-w-0 items-center gap-1">
            {index > 0 && <ChevronRight className="size-3.5 shrink-0 text-line-hi" />}
            <span className={index === crumbs.length - 1 ? 'truncate text-[13px] font-medium text-ink' : 'truncate text-[13px] text-faint'}>{crumb}</span>
          </span>
        ))}
      </nav>
      <div className="ml-auto flex shrink-0 flex-wrap items-center justify-end gap-2">{right}</div>
    </header>
  )
}
