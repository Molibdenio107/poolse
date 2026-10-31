import { Montserrat, Poppins, Quicksand } from 'next/font/google';

/**
 * The three typefaces from the Claude Design handoff — POOLSE-138.
 *
 * Self-hosted by `next/font` at build time: no browser ever asks Google for a
 * font. Each is exposed as a CSS variable on `<body>` (never `<html>`, whose
 * class has one owner — POOLSE-99), and `tailwind.config.ts` reads them:
 * `font-sans` is the body, `font-heading` the headings. App mode
 * (`[data-surface='app']`) points both at Quicksand in `globals.css`.
 *
 * Headings are Poppins 600 only, by element (h1–h3, the page title) — never by
 * weight, so a bold sentence in a paragraph stays Montserrat.
 */
const heading = Poppins({
  subsets: ['latin'],
  weight: ['600'],
  display: 'swap',
  variable: '--font-heading',
});

const body = Montserrat({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  display: 'swap',
  variable: '--font-body',
});

const app = Quicksand({
  subsets: ['latin'],
  weight: ['500', '600', '700'],
  display: 'swap',
  variable: '--font-app',
});

/** The class every root layout puts on `<body>`. */
export const fontVariables = `${heading.variable} ${body.variable} ${app.variable}`;
