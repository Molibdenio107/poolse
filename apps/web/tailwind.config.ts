import type { Config } from 'tailwindcss';

/**
 * Colours are declared as CSS variables holding bare RGB channels, so Tailwind
 * can apply opacity modifiers (bg-primary/10) to tokens that swap with the theme.
 */
const rgb = (variable: string) => `rgb(var(${variable}) / <alpha-value>)`;

export default {
  darkMode: 'class',
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: rgb('--primary'),
          foreground: rgb('--primary-foreground'),
        },
        complementary: rgb('--complementary'),
        background: rgb('--background'),
        surface: {
          DEFAULT: rgb('--surface'),
          muted: rgb('--surface-muted'),
        },
        foreground: {
          DEFAULT: rgb('--foreground'),
          muted: rgb('--foreground-muted'),
        },
        border: rgb('--border'),
        success: rgb('--success'),
        warning: rgb('--warning'),
        danger: rgb('--danger'),
      },
      borderRadius: {
        DEFAULT: 'var(--radius)',
      },
    },
  },
  plugins: [],
} satisfies Config;
