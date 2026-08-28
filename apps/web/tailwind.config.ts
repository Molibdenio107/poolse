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
        // The boundary of an interactive control — WCAG 1.4.11. See globals.css.
        'border-strong': rgb('--border-strong'),

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
        // POOLSE-18. Tokens rather than per-component literals, so a role reads
        // the same in the People list, a filter chip and the invite dialog.
        role: {
          owner: rgb('--role-owner'),
          admin: rgb('--role-admin'),
          instructor: rgb('--role-instructor'),
          maintenance: rgb('--role-maintenance'),
          guardian: rgb('--role-guardian'),
          student: rgb('--role-student'),
        },
      },
      /*
       * The page shell's measurements — POOLSE-41.
       *
       * Tokens rather than literals in a component, so changing the rhythm of
       * every page is one edit here. AC4 asks for exactly this, and it is also
       * what makes the grep check in `scripts/check-layout.mjs` meaningful: a
       * page using `px-6` instead of `px-page` is a page that has drifted.
       */
      spacing: {
        page: '1.5rem',
        'page-y': '2.5rem',
        'page-gap': '2rem',
      },
      minHeight: {
        // Sized for a two-line title plus a subtitle, so a page with header
        // actions and one without are the same height — 41.7.
        'page-header': '4.5rem',
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
