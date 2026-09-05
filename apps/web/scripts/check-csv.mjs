#!/usr/bin/env node
/**
 * A CSV cell is written in one place, and this is what keeps it that way.
 *
 * The register's export, the calendar's, the inventory's and the water log each
 * grew their own four-line escaper. All four quoted the delimiter correctly and
 * none of them escaped a *formula*, so a value beginning `=`, `+`, `-` or `@` —
 * arriving through the import wizard in a new club's old spreadsheet — was
 * written back out as a live formula for an admin's Excel to run.
 *
 * The fix was one shared helper. The reason this file exists is that the fix
 * only holds until the fifth export is written, and the fifth export will be
 * written by somebody in an evening who reasonably copies the fourth.
 *
 * So: anything that assembles a CSV must go through `lib/csv.ts`. The check is
 * textual and deliberately blunt — it looks for the shapes that mean "a CSV is
 * being built here" and insists the file imports the helper.
 *
 * Run: pnpm csv:check
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const SRC = new URL('../src', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

/** The helper itself, and its test, are the exception — they *are* the rule. */
const EXEMPT = ['lib/csv.ts', 'lib/csv.test.ts'];

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...walk(path));
    else if (entry.endsWith('.ts') || entry.endsWith('.tsx')) out.push(path);
  }
  return out;
}

/**
 * What "this file writes a CSV body" looks like.
 *
 * Both of these are things the four copies actually did, rather than guesses at
 * what a future one might do. Note what is deliberately *not* here: declaring
 * `text/csv`, which every export route does while delegating the writing to a
 * `write-sheet.ts` that does import the helper, and `accept=".csv"` on a file
 * input. Flagging those made the check cry wolf on five innocent files, and a
 * check nobody believes is worse than no check.
 */
const WRITES_CSV = [
  { pattern: /\.join\(\s*['"`];['"`]\s*\)/, why: 'joins a row on the CSV delimiter' },
  { pattern: /\\uFEFF|﻿/, why: 'writes a byte-order mark' },
];

/** Having imported the shared helper, in any of the forms an import can take. */
const IMPORTS_HELPER = /from\s+['"](?:@\/lib\/csv|\.\/csv|\.\.\/[./]*lib\/csv)(?:\.ts)?['"]/;

/** A local escaper — the exact habit this check exists to catch. */
const LOCAL_ESCAPER = /(?:function|const)\s+\w*[cC]ell\w*\s*(?:\(|=)[^\n]*\n?[^\n]*replace\(\s*\/"/;

const problems = [];

for (const file of walk(SRC)) {
  const shown = relative(SRC, file).replace(/\\/g, '/');
  if (EXEMPT.includes(shown)) continue;

  /*
   * Tests are exempt, and that is not laziness. A parser test's whole job is to
   * hand `parseCsv` a hand-built file with a byte-order mark and semicolons in
   * it — that is the input, not an export, and nothing a customer opens. The
   * files that ship are the ones this check is for.
   */
  if (/\.test\.tsx?$/.test(shown)) continue;

  const text = readFileSync(file, 'utf8');
  const hit = WRITES_CSV.find(({ pattern }) => pattern.test(text));
  if (!hit) continue;

  if (!IMPORTS_HELPER.test(text)) {
    problems.push(
      `src/${shown}\n` +
        `    ${hit.why}, but does not import the shared writer.\n` +
        `    -> import { toCsv } from '@/lib/csv'. A hand-rolled escaper quotes the\n` +
        `       delimiter and forgets the formula, which is the bug this replaced.`,
    );
    continue;
  }

  if (LOCAL_ESCAPER.test(text)) {
    problems.push(
      `src/${shown}\n` +
        `    defines its own cell escaper alongside the shared one.\n` +
        `    -> delete it and use csvCell/toCsv, or the two will drift.`,
    );
  }
}

if (problems.length > 0) {
  console.log(`${problems.length} thing(s) to look at:\n`);
  for (const problem of problems) console.log(`  ${problem}\n`);
  process.exit(1);
}

console.log('Every CSV goes through lib/csv.ts.');
