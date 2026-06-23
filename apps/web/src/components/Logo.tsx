type Tone = 'dark' | 'light' | 'mono';

const TONES: Record<Tone, { bar: string; accent: string; text: string; caret: string }> = {
  dark: { bar: '#C8A96A', accent: '#2BB68C', text: '#E8EAED', caret: '#C8A96A' },
  light: { bar: '#B0863C', accent: '#2BB68C', text: '#1A1A18', caret: '#B0863C' },
  mono: { bar: 'currentColor', accent: 'currentColor', text: 'currentColor', caret: 'currentColor' },
};

/** Cadence mark + live-text wordmark (design tokens §9). */
export function Logo({
  size = 28,
  wordmark = true,
  tone = 'dark',
}: {
  size?: number;
  wordmark?: boolean;
  tone?: Tone;
}) {
  const c = TONES[tone];
  const fs = Math.round(size * 1.18);
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: size * 0.34 }}>
      <svg width={size} height={size} viewBox="0 0 48 48" role="img" aria-label="Cadence">
        <rect x="6" y="21" width="6" height="16" rx="3" fill={c.bar} />
        <rect x="16" y="11" width="6" height="26" rx="3" fill={c.accent} />
        <rect x="26" y="25" width="6" height="12" rx="3" fill={c.bar} />
        <rect x="36" y="17" width="6" height="20" rx="3" fill={c.bar} />
      </svg>
      {wordmark && (
        <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 1 }}>
          <span
            style={{
              fontSize: fs,
              fontWeight: 600,
              letterSpacing: '-0.022em',
              color: c.text,
              lineHeight: 1,
            }}
          >
            cadence
          </span>
          <span
            aria-hidden
            style={{
              width: Math.max(2, size * 0.12),
              height: fs * 0.82,
              background: c.caret,
              borderRadius: 2,
              transform: `translateY(${size * 0.1}px)`,
              display: 'inline-block',
            }}
          />
        </span>
      )}
    </span>
  );
}
