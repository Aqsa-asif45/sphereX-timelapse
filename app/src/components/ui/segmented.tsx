import { cn } from '@/lib/utils';

/** A small single-choice button group (aria-pressed buttons inside a labelled group). */
export function Segmented<T extends string>({ label, value, options, onChange, className }: {
  label: string; value: T; options: { value: T; label: string; title?: string }[]; onChange: (v: T) => void; className?: string;
}) {
  return (
    <div role="group" aria-label={label} className={cn('inline-flex rounded-ctl border border-line-2 bg-panel p-0.5', className)}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          title={o.title}
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            'h-7 rounded-[4px] px-2.5 text-xs font-medium text-ink-2 transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus',
            value === o.value && 'bg-raised text-ink shadow-[inset_0_0_0_1px_#5fd4e3]',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
