/**
 * Checks that every translation key the code asks for exists, in every locale.
 *
 * TypeScript cannot do this: `t('facilities.title')` is a string, and a typo in
 * it compiles, builds, deploys, and then renders the key itself on screen in
 * front of a customer. i18n is a non-negotiable convention in this repo
 * (CLAUDE.md), so it gets a check rather than a hope.
 *
 * Three things are verified:
 *
 *   1. Both catalogues have exactly the same keys. A string added to `pt-PT` and
 *      forgotten in `en` is the normal way this breaks.
 *   2. Every literal `t('…')` in the source resolves in every catalogue.
 *   3. Every computed `t(`prefix.${…}`)` has its prefix present as an object.
 *      The leaf cannot be known statically, but a missing namespace can.
 *
 * Run: pnpm --filter @poolse/web i18n:check   (or pnpm i18n:check from the root)
 */
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MESSAGES = join(ROOT, 'src', 'messages');
const SOURCE = join(ROOT, 'src');

/** Flattens {a: {b: 'x'}} to the set {'a.b'}, and records objects as namespaces. */
function walk(value, prefix, leaves, namespaces) {
  for (const [key, child] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (child !== null && typeof child === 'object') {
      namespaces.add(path);
      walk(child, path, leaves, namespaces);
    } else {
      leaves.add(path);
    }
  }
}

async function loadCatalogues() {
  const files = (await readdir(MESSAGES)).filter((f) => f.endsWith('.json'));
  const catalogues = new Map();

  for (const file of files) {
    const parsed = JSON.parse(await readFile(join(MESSAGES, file), 'utf8'));
    const leaves = new Set();
    const namespaces = new Set();
    walk(parsed, '', leaves, namespaces);
    catalogues.set(file.replace(/\.json$/, ''), { leaves, namespaces });
  }

  return catalogues;
}

async function* sourceFiles(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* sourceFiles(full);
    } else if (/\.tsx?$/.test(entry.name)) {
      yield full;
    }
  }
}

// t('a.b') and t("a.b") — the literal case.
const LITERAL = /\bt\(\s*['"]([A-Za-z0-9_.-]+)['"]/g;
// t(`a.b.${x}`) — the computed case; only the static prefix is checkable.
const COMPUTED = /\bt\(\s*`([A-Za-z0-9_.-]*?)\.?\$\{/g;

async function main() {
  const catalogues = await loadCatalogues();
  if (catalogues.size === 0) throw new Error(`No catalogues found in ${MESSAGES}`);

  const problems = [];

  // 1. Structural parity between locales.
  const [reference, ...others] = [...catalogues.keys()].sort();
  const referenceKeys = catalogues.get(reference).leaves;

  for (const locale of others) {
    const keys = catalogues.get(locale).leaves;
    for (const key of referenceKeys) {
      if (!keys.has(key)) problems.push(`${locale}.json is missing "${key}" (present in ${reference})`);
    }
    for (const key of keys) {
      if (!referenceKeys.has(key)) problems.push(`${reference}.json is missing "${key}" (present in ${locale})`);
    }
  }

  // 2 and 3. Every key the source asks for.
  let literals = 0;
  let computed = 0;

  for await (const file of sourceFiles(SOURCE)) {
    const source = await readFile(file, 'utf8');
    const where = relative(ROOT, file);

    for (const [, key] of source.matchAll(LITERAL)) {
      literals += 1;
      for (const [locale, { leaves }] of catalogues) {
        if (!leaves.has(key)) problems.push(`${where}: t('${key}') has no entry in ${locale}.json`);
      }
    }

    for (const [, prefix] of source.matchAll(COMPUTED)) {
      if (!prefix) continue;
      computed += 1;
      for (const [locale, { namespaces }] of catalogues) {
        if (!namespaces.has(prefix)) {
          problems.push(`${where}: t(\`${prefix}.\${…}\`) — no "${prefix}" namespace in ${locale}.json`);
        }
      }
    }
  }

  const locales = [...catalogues.keys()].join(', ');
  if (problems.length > 0) {
    console.error(`\n${problems.length} problem(s):\n`);
    for (const problem of problems) console.error(`  ✗ ${problem}`);
    console.error('');
    process.exit(1);
  }

  console.log(
    `All translation keys resolve: ${literals} literal, ${computed} computed, ` +
      `across ${catalogues.size} locales (${locales}).`,
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
