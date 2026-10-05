/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        background: '#09090C',
        foreground: '#F0F2F5',
        card: '#0F1115',
        'card-foreground': '#F0F2F5',
        popover: '#0F1115',
        'popover-foreground': '#F0F2F5',
        muted: '#191D22',
        'muted-foreground': '#8A93A5',
        secondary: '#191D22',
        'secondary-foreground': '#D6D9DE',
        primary: { DEFAULT: '#FFC105', foreground: '#0D0E12' },
        accent: { DEFAULT: '#23272E', foreground: '#F0F2F5' },
        destructive: { DEFAULT: '#E63939', foreground: '#FAFAFA' },
        border: '#1F2228',
        input: '#1F2228',
        ring: '#FFC105',
        sidebar: {
          bg: '#0B0C0F',
          fg: '#D6D9DE',
          hover: '#15171B',
          active: '#FFC105',
          'active-fg': '#0D0E12',
          border: '#191D22'
        },
        up: '#34d399',
        down: '#f87171'
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
