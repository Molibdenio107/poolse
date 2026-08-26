import type { Config } from 'tailwindcss';
import animate from 'tailwindcss-animate';

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

        // shadcn/ui component names, pointing at the same palette. See the note
        // at the top of globals.css.
        card: {
          DEFAULT: rgb('--card'),
          foreground: rgb('--card-foreground'),
        },
        popover: {
          DEFAULT: rgb('--popover'),
          foreground: rgb('--popover-foreground'),
        },
        secondary: {
          DEFAULT: rgb('--secondary'),
          foreground: rgb('--secondary-foreground'),
        },
        muted: {
          DEFAULT: rgb('--muted'),
          foreground: rgb('--muted-foreground'),
        },
        accent: {
          DEFAULT: rgb('--accent'),
          foreground: rgb('--accent-foreground'),
        },
        destructive: {
          DEFAULT: rgb('--destructive'),
          foreground: rgb('--destructive-foreground'),
        },
        input: rgb('--input'),
        ring: rgb('--ring'),
        success: rgb('--success'),
        warning: rgb('--warning'),
        danger: rgb('--danger'),
      },
      borderRadius: {
        DEFAULT: 'var(--radius)',
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
    },
  },
  // shadcn components use animate-in / fade-in / zoom-in utilities.
  plugins: [animate],
} satisfies Config;
