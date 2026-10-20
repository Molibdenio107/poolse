import type { MetadataRoute } from 'next';

/**
 * Poolse as an installable app — POOLSE-88.
 *
 * Served at `/manifest.webmanifest`, which the middleware matcher already
 * leaves alone. Standalone, so the installed app opens with no browser bar, and
 * it starts on the dashboard every signed-in page already leads to.
 *
 * **No service worker**: Chrome installs without one, and a caching worker is
 * the offline work the ticket leaves out. iOS reads none of the icons below —
 * it takes `apple-touch-icon` from the root layout's metadata instead.
 *
 * The colours are the light theme's surface and background tokens (`--surface`,
 * `--background` in globals.css). A manifest holds one theme colour; the dark
 * one reaches the browser through the viewport's `themeColor`.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Poolse',
    short_name: 'Poolse',
    description: 'Gestão de piscinas',
    lang: 'pt-PT',
    start_url: '/dashboard',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#FAFBFC',
    theme_color: '#FFFFFF',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
