import { Check } from 'lucide-react'
import { cn } from '@/lib/cn'

export function Checkbox({
  checked,
  onChange,
  disabled,
  className,
  'aria-label': ariaLabel,
}: {
  checked: boolean
  onChange: () => void
  disabled?: boolean
  className?: string
  'aria-label'?: string
}) {
  return (
    <span className={cn('relative inline-flex size-4 shrink-0 items-center justify-center', className)}>
      <input
        type="checkbox"
        aria-label={ariaLabel}
        checked={checked}
        disabled={disabled}
        onChange={onChange}
        className="peer absolute inset-0 m-0 cursor-pointer appearance-none rounded-[5px] border border-line-hi bg-canvas transition-colors checked:border-accent checked:bg-accent disabled:cursor-not-allowed disabled:opacity-45"
      />
      <Check className="pointer-events-none relative z-10 size-3 text-white opacity-0 transition-opacity peer-checked:opacity-100" strokeWidth={3} />
    </span>
  )
}
