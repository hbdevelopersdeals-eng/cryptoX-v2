/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      /* Every colour is a CSS variable so a theme is an attribute change, not a
         rebuild: see :root and [data-theme='light'] in src/styles.css. The
         <alpha-value> placeholder keeps opacity utilities (bg-primary/10) working. */
      colors: {
        background: 'rgb(var(--background) / <alpha-value>)',
        foreground: 'rgb(var(--foreground) / <alpha-value>)',
        card: 'rgb(var(--card) / <alpha-value>)',
        'card-foreground': 'rgb(var(--card-foreground) / <alpha-value>)',
        popover: 'rgb(var(--popover) / <alpha-value>)',
        'popover-foreground': 'rgb(var(--popover-foreground) / <alpha-value>)',
        muted: 'rgb(var(--muted) / <alpha-value>)',
        'muted-foreground': 'rgb(var(--muted-foreground) / <alpha-value>)',
        secondary: 'rgb(var(--secondary) / <alpha-value>)',
        'secondary-foreground': 'rgb(var(--secondary-foreground) / <alpha-value>)',
        primary: { DEFAULT: 'rgb(var(--primary) / <alpha-value>)', foreground: 'rgb(var(--primary-foreground) / <alpha-value>)' },
        accent: { DEFAULT: 'rgb(var(--accent) / <alpha-value>)', foreground: 'rgb(var(--accent-foreground) / <alpha-value>)' },
        destructive: { DEFAULT: 'rgb(var(--destructive) / <alpha-value>)', foreground: 'rgb(var(--destructive-foreground) / <alpha-value>)' },
        border: 'rgb(var(--border) / <alpha-value>)',
        input: 'rgb(var(--input) / <alpha-value>)',
        ring: 'rgb(var(--ring) / <alpha-value>)',
        sidebar: {
          bg: 'rgb(var(--sidebar-bg) / <alpha-value>)',
          fg: 'rgb(var(--sidebar-fg) / <alpha-value>)',
          hover: 'rgb(var(--sidebar-hover) / <alpha-value>)',
          active: 'rgb(var(--sidebar-active) / <alpha-value>)',
          'active-fg': 'rgb(var(--sidebar-active-fg) / <alpha-value>)',
          border: 'rgb(var(--sidebar-border) / <alpha-value>)'
        },
        up: 'rgb(var(--up) / <alpha-value>)',
        down: 'rgb(var(--down) / <alpha-value>)'
      },
      fontFamily: {
        sans: ["system-ui", "-apple-system", "'Segoe UI'", "Roboto", "'Helvetica Neue'", "Arial", "sans-serif"],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "Consolas", "'Liberation Mono'", "monospace"]
      },
      keyframes: {
        marquee: { '0%': { transform: 'translateX(0)' }, '100%': { transform: 'translateX(-50%)' } },
        pulseSoft: { '0%,100%': { opacity: '1' }, '50%': { opacity: '0.55' } },
        fadeUp: { from: { opacity: '0', transform: 'translateY(6px)' }, to: { opacity: '1', transform: 'translateY(0)' } }
      },
      animation: {
        marquee: 'marquee 40s linear infinite',
        'marquee-fast': 'marquee 26s linear infinite',
        pulseSoft: 'pulseSoft 2.4s ease-in-out infinite',
        fadeUp: 'fadeUp 0.25s ease-out'
      }
    }
  },
  plugins: []
};
