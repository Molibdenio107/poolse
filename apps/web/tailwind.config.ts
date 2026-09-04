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
        // Booking categories that have no other token to borrow — POOLSE-55.
        category: {
          teal: rgb('--category-teal'),
          violet: rgb('--category-violet'),
        },
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
        /*
         * The app bar's height — round 4.
         *
         * It exists so two things can agree without either measuring the other:
         * the bar is `h-app-bar`, and the sticky back control below it is
         * `top-app-bar`. Before, the bar was sized by its own padding, so
         * anything wanting to sit underneath had to guess a pixel value that
         * would be wrong the next time somebody changed the padding.
         */
        'app-bar': '3.5rem',
      },
      minHeight: {
        // Sized for a two-line title plus a subtitle, so a page with header
        // actions and one without are the same height — 41.7.
        'page-header': '4.5rem',
      },
      maxWidth: {
        /*
         * How wide a page's content is allowed to get.
         *
         * The shell was full-bleed, which reads as designed on a laptop and as
         * an accident on a 27-inch monitor: a table stretched to 2400px puts
         * the name and the action forty centimetres apart, and a two-field form
         * becomes two lines of horizon. 80rem is the width the eye can still
         * cross — roughly the point where a data row stops needing to be
         * traced with a finger.
         *
         * Below this the page is fluid and `px-page` does the rest, so the
         * small-screen behaviour is unchanged.
         */
        page: '80rem',
        /*
         * A single form control, and a column of them.
         *
         * A postcode box the width of the viewport tells you the field wants a
         * paragraph. These two caps are what stop that, and they are the knobs
         * to turn if the forms end up feeling cramped rather than tidy.
         *
         * Narrowed in round 4, from 22rem/36rem. 22rem still read as wide
         * because almost nothing in these forms is long: a pool name, a lane
         * count, a depth in metres and a time all fit inside 18rem with room to
         * spare, and sizing every one of them for the longest imaginable street
         * address made a page of eight fields look like a page of eight
         * paragraphs. Fields that genuinely hold prose — every `TextAreaField` —
         * take `max-w-form` instead and are unaffected by the first number.
         */
        field: '18rem',
        form: '32rem',
      },
      height: {
        /*
         * One height for every single-line control — input, select, search box.
         *
         * Named rather than repeated as `h-9`, because the point is that they
         * agree: an input beside a select beside a search box, all landing on
         * the same baseline, is the difference between a filter row and three
         * controls that happen to be adjacent.
         */
        control: '2.25rem',
      },

      /*
       * "Today" says where it took you — round 5.
       *
       * Pressing Today when you are already looking at this week changes nothing
       * on screen, so the button read as broken. A brief wash of the primary
       * colour over today's column answers "where did I land" without adding a
       * permanent highlight that would compete with the closures and cancelled
       * classes already using colour on that grid.
       *
       * `forwards` so it settles on transparent rather than snapping back, and
       * under 1.5s so it is a cue rather than an animation somebody waits out.
       */
      keyframes: {
        'flash-today': {
          '0%': { backgroundColor: 'rgb(var(--primary) / 0.18)' },
          '100%': { backgroundColor: 'rgb(var(--primary) / 0)' },
        },
      },
      animation: {
        'flash-today': 'flash-today 1.4s ease-out forwards',
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
