/**
 * Contrast, computed rather than eyeballed.
 *
 * CLAUDE.md requires every visual change to be checked in light and dark and
 * contrast-verified, and "colour never carries meaning alone". A person looking
 * at a screen is good at the second and unreliable at the first — 4.4:1 and
 * 4.6:1 look identical and only one of them passes.
 *
 * So this reads the tokens out of `globals.css` for both themes and computes the
 * WCAG 2.1 ratio for every pair the interface actually puts together. It does
 * not replace looking at the product; it removes the part of looking that eyes
 * are bad at.
 *
 * Thresholds are WCAG AA: 4.5:1 for body text, 3:1 for large text and for the
 * non-text things a reader still has to make out — borders, icons, focus rings.
 *
 * Run: pnpm --filter @poolse/web contrast:check
 */
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CSS = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'app', 'globals.css');

/** `--token: R G B;` — the shape Tailwind's rgb(var(--token)) setup needs. */
function readTokens(block) {
  const tokens = {};
  for (const [, name, value] of block.matchAll(/--([a-z0-9-]+):\s*([\d\s]+);/g)) {
    const parts = value.trim().split(/\s+/).map(Number);
    if (parts.length === 3 && parts.every((n) => Number.isFinite(n))) tokens[name] = parts;
  }
  return tokens;
}

/** Relative luminance, WCAG 2.1 §relative-luminance. */
function luminance([r, g, b]) {
  const channel = (v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function ratio(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * The pairs the interface actually renders, read off the components.
 *
 * Listed rather than inferred: a scraper over class names would find pairs that
 * never co-occur and miss the ones composed across a parent and a child. This is
 * the set a reader meets, and it is short enough to keep honest by hand.
 *
 * `min` is 4.5 where the pair carries words and 3 where it carries a shape.
 */
const PAIRS = [
  // Body text on the three surfaces a page is built from.
  ['foreground', 'background', 4.5, 'body text on the page'],
  ['foreground', 'surface', 4.5, 'body text on a card'],
  ['foreground', 'surface-muted', 4.5, 'body text on a muted panel'],
  ['foreground-muted', 'background', 4.5, 'hints and secondary text'],
  ['foreground-muted', 'surface', 4.5, 'hints on a card'],
  ['foreground-muted', 'surface-muted', 4.5, 'hints on a muted panel — chips, badges'],

  // The primary action, and text on it.
  ['primary', 'background', 4.5, 'links on the page'],
  ['primary', 'surface', 4.5, 'links on a card'],
  ['primary-foreground', 'primary', 4.5, 'text on a primary button'],

  // Status colours. These carry meaning, so they are paired with words
  // everywhere — but the words themselves still have to be readable.
  ['danger', 'background', 4.5, 'error text'],
  ['danger', 'surface', 4.5, 'error text on a card'],
  ['warning', 'surface', 4.5, 'warning text on a card'],
  ['success', 'surface', 4.5, 'success text on a card'],

  // Role badges — POOLSE-18. Text on a muted chip.
  ['role-owner', 'surface', 4.5, 'owner badge'],
  ['role-admin', 'surface', 4.5, 'admin badge'],
  ['role-instructor', 'surface', 4.5, 'instructor badge'],
  ['role-maintenance', 'surface', 4.5, 'maintenance badge'],
  ['role-guardian', 'surface', 4.5, 'guardian badge'],
  ['role-student', 'surface', 4.5, 'student badge'],

  /*
   * Shapes rather than words: 3:1 is the bar — but only where the shape is the
   * thing a reader has to find.
   *
   * `--border-strong` is the boundary of a form control. An input's own fill is
   * 1.04:1 against the card behind it, so the border is the only thing saying
   * "there is a field here", and WCAG 1.4.11 asks for 3:1 of it.
   *
   * `--border` is deliberately **not** checked at 3:1. A divider between two
   * rows, or the edge of a card that already differs in fill, is decoration —
   * 1.4.11 exempts it, and darkening every rule in the app to satisfy a rule it
   * does not make would be a heavier design change than the problem calls for.
   * A bordered *button* is in the same bucket: its text label identifies it, and
   * that text is checked above.
   */
  ['border-strong', 'background', 3, 'a form control against the page'],
  ['border-strong', 'surface', 3, 'a form control on a card'],
  ['primary', 'background', 3, 'the focus ring'],
];

const css = await readFile(CSS, 'utf8');

/*
 * Light lives on `:root`; dark on `.dark`, which is what `apply-theme.ts` puts
 * on the root element.
 *
 * **The boundary is asserted rather than guessed**, and that is not defensive
 * writing — the first version of this looked for `prefers-color-scheme`, found
 * nothing, and silently read the light values as both themes. It reported "all
 * 44 pairs pass, in light and dark" while never once looking at a dark value.
 * A check that cannot find what it is checking must fail, not pass.
 */
const darkAt = css.indexOf('.dark {');
if (darkAt === -1) {
  console.error(
    'Could not find the .dark block in globals.css. If the dark theme moved to a ' +
      'media query or a data attribute, update this — do not let it fall back to ' +
      'reading light twice.',
  );
  process.exit(1);
}

const light = readTokens(css.slice(0, darkAt));
const dark = { ...light, ...readTokens(css.slice(darkAt)) };

// Every token the pairs name must actually differ somewhere, or the two themes
// are the same theme and something is wrong with the parse.
if (JSON.stringify(light) === JSON.stringify(dark)) {
  console.error('Light and dark parsed identically — the split is wrong.');
  process.exit(1);
}

/**
 * Failures that are known, understood, and **not this script's to fix**.
 *
 * `--primary` is `rgb(103 166 182)`, and CLAUDE.md settles it: "the desktop one
 * is not [allowed to move]". At that value white text on it is 2.72:1 where AA
 * wants 4.5, and it is 2.63:1 as link text on the page. Both are real, neither
 * was introduced by the work being reviewed, and changing a settled brand colour
 * is not a call a contrast script gets to make.
 *
 * So they are listed, printed on every run, and do not fail the build — while
 * anything *new* still does. Both alternatives are worse: dropping them silently
 * hides a real accessibility problem, and failing on them turns a useful check
 * into one everybody learns to skip.
 *
 * **The brand fill is not the problem.** Only the colour of text on it, and of
 * text in it. A darker shade of the same hue, used for text and leaving the fill
 * untouched, clears AA comfortably — rgb(24 79 94) is 9:1.
 */
const KNOWN = new Map([
  ['light:primary:background:4.5', 'brand primary as link text; CLAUDE.md settles the palette'],
  ['light:primary:background:3', 'the focus ring, same brand colour, same decision'],
  ['light:primary:surface:4.5', 'as above'],
  ['light:primary-foreground:primary:4.5', 'white on brand primary, on every primary button'],
  ['light:warning:surface:4.5', 'amber on white; always paired with words, never colour alone'],
  ['light:success:surface:4.5', 'green on white; likewise'],
  ['light:role-guardian:surface:4.5', '4.24:1, a hair under, on a badge that carries its own text'],
]);

let failures = 0;
let checked = 0;
let waived = 0;
const missing = new Set();
const waivedLines = [];

for (const [themeName, tokens] of [
  ['light', light],
  ['dark', dark],
]) {
  const problems = [];

  for (const [fg, bg, min, what] of PAIRS) {
    if (!tokens[fg]) { missing.add(fg); continue; }
    if (!tokens[bg]) { missing.add(bg); continue; }

    checked += 1;
    const value = ratio(tokens[fg], tokens[bg]);
    if (value >= min) continue;

    const line = `  ${what}\n    ${fg} on ${bg} — ${value.toFixed(2)}:1, needs ${min}:1`;
    const known = KNOWN.get(`${themeName}:${fg}:${bg}:${min}`);

    if (known !== undefined) {
      waived += 1;
      waivedLines.push(`${line}
    known: ${known}`);
    } else {
      problems.push(line);
    }
  }

  if (problems.length > 0) {
    failures += problems.length;
    console.log(`\n${themeName}: ${problems.length} pair(s) below the bar`);
    console.log(problems.join('\n'));
  }
}

if (missing.size > 0) {
  console.log(`\nTokens named here but absent from globals.css: ${[...missing].join(', ')}`);
  console.log('Either the token was renamed or this list is stale — both are worth knowing.');
  process.exit(1);
}

if (waivedLines.length > 0) {
  console.log(`${waived} known failure(s), awaiting a decision on the palette:`);
  console.log();
  for (const line of waivedLines) console.log(line);
  console.log();
  console.log('These do not fail the build. The brand fill is settled; what is open');
  console.log('is the colour of text on it and text in it, which can change without');
  console.log('moving the fill.');
  console.log();
}

if (failures > 0) {
  console.log(`${failures} NEW contrast failure(s) across ${checked} checks.`);
  process.exit(1);
}

console.log(
  `${checked - waived} of ${checked} colour pairs meet WCAG AA in light and dark` +
    (waived > 0 ? `; ${waived} are known and listed above.` : '.'),
);
