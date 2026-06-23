import type { Config } from 'tailwindcss';

// Design tokens — dark "engineering instrument" (spec §9).
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: '#15171c',
        panel: '#1c1f26',
        surface: '#21252e',
        surface2: '#272c36',
        text: '#e8eaed',
        text2: '#9aa0aa',
        text3: '#686d77',
        brass: '#c8a96a',
        danger: '#ef5b5b',
        success: '#5bc07a',
        activity: {
          coding: '#2bb68c',
          debugging: '#f0a93b',
          research: '#4c9aea',
          agent: '#9a8cf0',
          review: '#8a909b',
        },
      },
      borderColor: {
        DEFAULT: 'rgba(255,255,255,.08)',
        hair: 'rgba(255,255,255,.07)',
        hair2: 'rgba(255,255,255,.14)',
      },
      borderRadius: {
        DEFAULT: '8px',
        lg: '12px',
        xl: '16px',
        '2xl': '20px',
      },
      letterSpacing: {
        tightish: '-0.01em',
      },
      transitionDuration: {
        DEFAULT: '150ms',
      },
      keyframes: {
        'fade-in': {
          from: { opacity: '0', transform: 'translateY(2px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        'fade-in': 'fade-in 180ms ease-out',
      },
      fontFamily: {
        sans: ['system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
        mono: ['ui-monospace', 'Menlo', 'Monaco', 'SFMono-Regular', 'monospace'],
      },
      fontWeight: {
        normal: '400',
        medium: '500',
        semibold: '600',
      },
    },
  },
  plugins: [],
} satisfies Config;
