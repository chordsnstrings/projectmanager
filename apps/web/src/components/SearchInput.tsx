import { useEffect, useRef } from 'react';

/**
 * Compact, animated search field. A magnifier that tints on focus, an inline
 * clear (✕) that fades in when there's text, and Escape-to-clear. Purely
 * presentational — the parent owns the query and does the filtering.
 */
export default function SearchInput({
  value,
  onChange,
  placeholder = 'Search…',
  autoFocus = false,
  className = '',
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
  className?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (autoFocus) ref.current?.focus();
  }, [autoFocus]);

  return (
    <div className={`group relative ${className}`}>
      <span
        aria-hidden
        className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-text3 text-sm transition-colors group-focus-within:text-brass"
      >
        ⌕
      </span>
      <input
        ref={ref}
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && value) {
            e.preventDefault();
            onChange('');
          }
        }}
        placeholder={placeholder}
        aria-label={placeholder}
        className="field h-8 w-full pl-7 pr-7 text-xs font-mono [&::-webkit-search-cancel-button]:hidden"
      />
      <button
        type="button"
        aria-label="clear search"
        onClick={() => onChange('')}
        className={`absolute right-1.5 top-1/2 -translate-y-1/2 h-5 w-5 rounded-full grid place-items-center text-text3 hover:text-text hover:bg-white/10 transition-all ${
          value ? 'opacity-100 scale-100' : 'opacity-0 scale-75 pointer-events-none'
        }`}
      >
        ✕
      </button>
    </div>
  );
}
