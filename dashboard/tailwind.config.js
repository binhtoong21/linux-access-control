/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './src/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        canvas: 'var(--c-canvas)',
        surface: 'var(--c-surface)',
        line: 'var(--c-line)',
        control: 'var(--c-control-border)',
        'control-border': 'var(--c-control-border)',
        ink: 'var(--c-ink)',
        'ink-muted': 'var(--c-ink-muted)',
        accent: 'var(--c-accent)',
        'accent-hover': 'var(--c-accent-hover)',
        'accent-tint': 'var(--c-accent-tint)',
        ok: 'var(--c-ok)',
        'ok-tint': 'var(--c-ok-tint)',
        warn: 'var(--c-warn)',
        'warn-tint': 'var(--c-warn-tint)',
        danger: 'var(--c-danger)',
        'danger-tint': 'var(--c-danger-tint)',
      },
      fontFamily: {
        sans: ['"Be Vietnam Pro"', 'system-ui', '-apple-system', '"Segoe UI"', 'Roboto', '"Noto Sans"', 'sans-serif'],
        mono: ['ui-monospace', '"Cascadia Mono"', '"DejaVu Sans Mono"', 'Menlo', 'Consolas', 'monospace'],
      },
      fontSize: {
        sm2: ['13px', '18px'],
      },
      borderRadius: {
        DEFAULT: '4px',
        dialog: '6px',
      },
    },
  },
  plugins: [],
};
