import type { TabGlyph } from '@/lib/app-hats';

/**
 * The app's tab shapes, from the design handoff — POOLSE-136: *Início* a
 * square, *Aulas* a circle, *Pagamentos* a triangle, *Perfil* a diamond, and
 * the hexagon *Modalidades* drawn here for POOLSE-127 but not mounted.
 *
 * `currentColor`, filled when the tab is current and outlined when it is not,
 * so the current tab is still the current tab with colour removed (the tab also
 * carries `aria-current`). Decorative: the label beside it names the tab.
 */
export function TabGlyph({ glyph, active }: { glyph: TabGlyph; active: boolean }): React.ReactElement {
  const paint = active
    ? { fill: 'currentColor', stroke: 'currentColor' }
    : { fill: 'none', stroke: 'currentColor' };
  return (
    <svg viewBox="0 0 24 24" className="size-6 shrink-0" aria-hidden strokeWidth={1.75} strokeLinejoin="round">
      {glyph === 'square' && <rect x="5" y="5" width="14" height="14" rx="1" {...paint} />}
      {glyph === 'circle' && <circle cx="12" cy="12" r="7.5" {...paint} />}
      {glyph === 'triangle' && <path d="M12 4.5 20 19H4z" {...paint} />}
      {glyph === 'diamond' && <path d="M12 3.5 20.5 12 12 20.5 3.5 12z" {...paint} />}
      {glyph === 'hexagon' && <path d="M12 3.5 19.4 7.75v8.5L12 20.5l-7.4-4.25v-8.5z" {...paint} />}
    </svg>
  );
}
