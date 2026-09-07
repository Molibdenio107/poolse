#!/usr/bin/env node
/**
 * A named date format that was never configured is a crash, not a fallback.
 *
 * `format.dateTime(date, 'long')` takes a plain string. next-intl has no
 * built-in `long` or `short`, so asking for one nobody defined throws
 * `MISSING_FORMAT` — at render time, the first time somebody opens the screen
 * that uses it.
 *
 * That is exactly how it went wrong: the lesson plan panel asked for `long` and
 * `short`, `i18n.ts` defined neither, and clicking any turma on the calendar
 * broke the page. Partnership bookings have no plan to open, so they went on
 * working, and the report was "the organization classes do not work" — which is
 * a long way from "a date format is missing".
 *
 * Nothing else catches it. The name is a string, so `tsc` has no opinion, and
 * next-intl v3 offers no way to narrow the argument to the configured names
 * (that arrived in v4 as `AppConfig`). So this reads both ends and compares.
 *
 * Run: pnpm i18n:check
 */

import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SRC = join(ROOT, 'src');
const CONFIG = join(SRC, 'i18n.ts');

/** Every .ts/.tsx under src, so a new caller is covered the day it is written. */
async function sources(dir) {
  const found = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...(await sources(path)));
    else if (/\.tsx?$/.test(entry.name)) found.push(path);
  }
  return found;
}

/**
 * The names `i18n.ts` defines, per formatter.
 *
 * Read out of the source rather than imported, because importing it would drag
 * in `next/headers` and the whole Next runtime for what is a list of words.
 */
function configured(source) {
  const names = { dateTime: new Set(), number: new Set(), list: new Set() };

  const block = source.match(/export const formats\s*=\s*\{([\s\S]*?)\n\} as const;/);
  if (block === null) throw new Error('No `export const formats = { … } as const;` in i18n.ts');

  for (const kind of Object.keys(names)) {
    const section = block[1].match(new RegExp(`${kind}:\\s*\\{([\\s\\S]*?)\\n  \\},`));
    if (section === null) continue;
    // A key at the start of a line inside the section: `long: { … }`.
    for (const [, name] of section[1].matchAll(/^\s{4}([A-Za-z]\w*):/gm)) {
      names[kind].add(name);
    }
  }

  return names;
}

/**
 * Every `format.dateTime(…, 'name')` in a file.
 *
 * Parentheses are balanced by hand rather than by a regular expression, because
 * the first argument is usually a call of its own — a template literal inside
 * `new Date(...)` is the common one — and a pattern that stops at the first
 * closing bracket finds nothing at all. Which is what the first version of this
 * did, and a check that silently matches nothing is worse than no check: it
 * reports success.
 *
 * A quoted last argument is a named format. An object literal is inline options
 * and needs no configuration, so it is skipped.
 */
function* namedFormats(source) {
  const call = /\.(dateTime|number|list)\(/g;

  for (const match of source.matchAll(call)) {
    const kind = match[1];
    const from = match.index + match[0].length;

    let depth = 1;
    let i = from;
    for (; i < source.length && depth > 0; i += 1) {
      if (source[i] === '(') depth += 1;
      else if (source[i] === ')') depth -= 1;
    }
    if (depth !== 0) continue;

    // The argument list, without its closing bracket.
    const args = source.slice(from, i - 1);
    // A trailing comma is allowed: a call broken over several lines ends
    // `'short',` and the first version of this missed every one of them.
    const named = args.match(/,\s*'([^']+)'\s*,?\s*$/);
    if (named !== null) yield { kind, name: named[1] };
  }
}

async function main() {
  const names = configured(await readFile(CONFIG, 'utf8'));
  const problems = [];
  let checked = 0;

  for (const file of await sources(SRC)) {
    const source = await readFile(file, 'utf8');

    for (const { kind, name } of namedFormats(source)) {
      checked += 1;
      if (!names[kind].has(name)) {
        problems.push(
          `${relative(ROOT, file)}: format.${kind}(…, '${name}') — ` +
            `not configured in i18n.ts (has: ${[...names[kind]].join(', ') || 'none'})`,
        );
      }
    }
  }

  if (problems.length > 0) {
    console.error(`\n${problems.length} problem(s):\n`);
    for (const problem of problems) console.error(`  ✗ ${problem}`);
    console.error('');
    process.exit(1);
  }

  const total = Object.values(names).reduce((sum, set) => sum + set.size, 0);
  console.log(
    `All ${checked} named format(s) resolve, against ${total} configured in i18n.ts.`,
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
