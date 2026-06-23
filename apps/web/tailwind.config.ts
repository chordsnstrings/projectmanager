import type { Config } from 'tailwindcss';

// Design tokens — modern, minimal dark UI. Deeper, slightly cool base; soft
// elevation; one confident brass accent; activity colours for data.
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: '#0b0c10', // deep, slightly cool near-black
        panel: '#13151b', // primary card surface
        surface: '#181b22', // inputs / nested surfaces
        surface2: '#20242d', // hover / elevated
        text: '#edeff3',
        text2: '#a3a9b5',
        text3: '#6a7080',
        brass: '#d8b67c', // brand accent (brighter, more confident)
        'brass-dim': '#9a7f53',
        danger: '#f0696b',
        success: '#5cc28d',
        activity: {
          coding: '#2bd4a0',
          debugging: '#f5b14b',
          research: '#5aa6f0',
          agent: '#a896f7',
          review: '#8a909b',
        },
      },
      borderColor: {
        DEFAULT: 'rgba(255,255,255,.06)',
        hair: 'rgba(255,255,255,.06)',
        hair2: 'rgba(255,255,255,.12)',
      },
      borderRadius: {
        DEFAULT: '10px',
        lg: '12px',
        xl: '16px',
        '2xl': '20px',
        '3xl': '24px',
      },
      letterSpacing: {
        tightish: '-0.011em',
        tight2: '-0.02em',
      },
      boxShadow: {
        card: '0 1px 0 0 rgba(255,255,255,0.03) inset, 0 12px 32px -16px rgba(0,0,0,0.7)',
        pop: '0 16px 48px -16px rgba(0,0,0,0.75), 0 0 0 1px rgba(255,255,255,0.06)',
        'glow-brass': '0 6px 24px -8px rgba(216,182,124,0.35)',
      },
      backgroundImage: {
        app: 'radial-gradient(1100px 600px at 78% -8%, rgba(216,182,124,0.06), transparent 60%), radial-gradient(900px 520px at 12% 0%, rgba(90,166,240,0.05), transparent 55%)',
      },
      transitionDuration: {
        DEFAULT: '160ms',
      },
      transitionTimingFunction: {
        smooth: 'cubic-bezier(0.22, 1, 0.36, 1)',
      },
      keyframes: {
        'fade-in': { from: { opacity: '0', transform: 'translateY(4px)' }, to: { opacity: '1', transform: 'translateY(0)' } },
        'scale-in': { from: { opacity: '0', transform: 'scale(0.98)' }, to: { opacity: '1', transform: 'scale(1)' } },
      },
      animation: {
        'fade-in': 'fade-in 240ms cubic-bezier(0.22,1,0.36,1)',
        'scale-in': 'scale-in 180ms cubic-bezier(0.22,1,0.36,1)',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Monaco', 'monospace'],
      },
      fontWeight: { normal: '400', medium: '500', semibold: '600' },
    },
  },
  plugins: [],
} satisfies Config;
