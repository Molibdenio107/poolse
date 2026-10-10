/**
 * Which text colour reads on a fill nobody chose from the palette — October
 * 2026 sweep.
 *
 * A partnership's colour is the club's own hex, so no token can be measured
 * against it in advance, and the calendar drew white on every one: a pale
 * yellow partner read at about 1.3:1. This returns whichever of white and
 * near-black has the higher WCAG contrast against the fill. They are the one
 * place a component names a colour, and they are named here so the reason is
 * written down once.
 */

const LIGHT_INK = 'rgb(255 255 255)';
const DARK_INK = 'rgb(12 18 21)';

function channel(value: number): number {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function luminance(r: number, g: number, b: number): number {
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** `#rgb` or `#rrggbb` to channels; null for anything else. */
function parseHex(hex: string): [number, number, number] | null {
  const raw = hex.trim().replace(/^#/, '');
  const full = raw.length === 3 ? [...raw].map((c) => c + c).join('') : raw;
  if (!/^[0-9a-f]{6}$/i.test(full)) return null;
  return [0, 2, 4].map((at) => parseInt(full.slice(at, at + 2), 16)) as [number, number, number];
}

/** The readable ink for `fill`, or null when the fill is not a hex colour. */
export function inkFor(fill: string): string | null {
  const rgb = parseHex(fill);
  if (rgb === null) return null;
  const l = luminance(...rgb);
  const onLight = (l + 0.05) / (luminance(12, 18, 21) + 0.05);
  const onDark = 1.05 / (l + 0.05);
  return onLight >= onDark ? DARK_INK : LIGHT_INK;
}
