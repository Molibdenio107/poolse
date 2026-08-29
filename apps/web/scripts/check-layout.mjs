import { readFile, readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Every page uses the shell — POOLSE-41.
 *
 * The drift this ticket fixed did not arrive all at once. It arrived one page at
 * a time, each for a good local reason, and nobody noticed until moving between
 * two screens felt like moving between two applications. Fixing it once without
 * a check just resets the clock.
 *
 * So: a page under `(app)/dashboard` must render `PageShell` and must not set its
 * own outer padding, margin or width. Both are cheap to grep and both are what
 * actually went wrong.
 *
 * Run: pnpm layout:check
 */

// `fileURLToPath`, not `.pathname`: on Windows the latter yields `/C:/...`,
// which `readdir` then resolves against the cwd into `C:\C:\...`.
const ROOT = fileURLToPath(new URL('../src/app', import.meta.url));

/**
 * Pages deliberately outside the shell.
 *
 * Sign-in and sign-up are Clerk's own centred cards, and the marketing pages are
 * a different product surface with their own layout. Listing them here rather
 * than pattern-matching keeps the exception visible: adding to this list is a
 * decision somebody makes, not something that happens.
 */
const EXEMPT = [
  'sign-in',
  'sign-up',
  '(marketing)',
  '(marketing-en)',
  // POOLSE-37's landing resolver. It renders nothing at all — it decides where
  // somebody goes and redirects — so there is no layout for it to share.
  'dashboard/start',
  // The water-quality report - round 4. It is a document rather than a screen:
  // it owns its own page geometry because that geometry is A4, and it is
  // deliberately monochrome so it does not print a dark-mode surface as a black
  // rectangle. The shell's chrome is hidden at print time rather than absent, so
  // this stays an ordinary authenticated page.
  'report',
];

/** Outer-layout classes on a page root — the thing the shell now owns. */
const OUTER = /className="[^"]*\b(?:px-\d|py-\d|p-\d|mx-auto|max-w-|min-h-screen)/;

async function pages(dir) {
  const found = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...(await pages(path)));
    else if (entry.name === 'page.tsx') found.push(path);
  }
  return found;
}

const failures = [];
const checked = [];

for (const path of await pages(ROOT)) {
  const shown = relative(ROOT, path).replace(/\\/g, '/');
  if (EXEMPT.some((part) => shown.includes(part))) continue;

  const source = await readFile(path, 'utf8');
  checked.push(shown);

  if (!source.includes('PageShell')) {
    failures.push(`${shown}: does not use PageShell`);
    continue;
  }

  // Only the page's own root matters; a `max-w` inside the content is fine, and
  // is sometimes exactly right for a narrow form.
  const root = source.slice(source.indexOf('<PageShell'));
  const before = source.slice(0, source.indexOf('<PageShell'));

  if (OUTER.test(before.replace(/<[A-Z][^>]*>/g, ''))) {
    failures.push(`${shown}: sets outer layout before the shell`);
  }
  if (/<main\b/.test(root) || /<main\b/.test(before)) {
    failures.push(`${shown}: renders its own <main>; the shell owns it`);
  }
}

if (failures.length > 0) {
  console.error('Pages not on the shared shell:\n');
  for (const failure of failures) console.error(`  ✗ ${failure}`);
  console.error(`\n${failures.length} of ${checked.length} pages have drifted.`);
  process.exit(1);
}

console.log(`All ${checked.length} app pages use the shared page shell.`);
