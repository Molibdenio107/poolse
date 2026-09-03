#!/usr/bin/env node
/**
 * A backtick inside a SQL template literal ends the string.
 *
 * This exists because it cost three build cycles in one evening. Writing
 * `SELECT ... /* see \`some_table\` *\/ ...` inside a JS template literal
 * terminates the literal at the first inner backtick, and TypeScript then
 * reports something bewildering several lines later — "Module declaration names
 * may only use ' or \" quoted strings" — which says nothing about backticks and
 * points at the wrong place.
 *
 * The habit that causes it is a good one: this codebase quotes identifiers in
 * prose everywhere, so reaching for a backtick inside a SQL comment is natural.
 * The only defence is a check that names the real problem.
 *
 * Heuristic and deliberately so: it looks at every backtick-delimited run that
 * contains SQL keywords and reports any that appear to have been cut short. It
 * cannot be exact without parsing TypeScript, and it does not need to be — a
 * false positive costs one glance and a false negative is what we have now.
 *
 * Run: pnpm --filter @poolse/api sql:check
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('../src', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

/** Every .ts file under src, recursively. */
function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...walk(path));
    else if (entry.endsWith('.ts')) out.push(path);
  }
  return out;
}

const SQL = /\b(SELECT|INSERT|UPDATE|DELETE|WITH|ALTER|CREATE)\b/i;

const problems = [];

for (const file of walk(ROOT)) {
  const text = readFileSync(file, 'utf8');
  const lines = text.split('\n');

  /*
   * Track whether we are inside a template literal, line by line.
   *
   * Crude on purpose. What it is looking for is a line *inside* a SQL literal
   * that contains a backtick — because that backtick is almost certainly meant
   * as prose quoting and is in fact closing the string.
   */
  let inLiteral = false;
  let literalStart = 0;
  let looksLikeSql = false;

  lines.forEach((line, index) => {
    const ticks = (line.match(/`/g) ?? []).length;

    if (!inLiteral) {
      if (ticks % 2 === 1) {
        inLiteral = true;
        literalStart = index + 1;
        looksLikeSql = SQL.test(line);
      }
      return;
    }

    // Inside a literal: a line that is only prose but carries a backtick pair
    // is the bug — it closes and reopens the string mid-SQL.
    if (looksLikeSql && ticks >= 2 && /^\s*\*/.test(line)) {
      problems.push(
        `${file}:${index + 1}\n` +
          `    a backtick inside a SQL template literal (opened line ${literalStart})\n` +
          `    ${line.trim()}\n` +
          `    -> the first one ends the string. Write the identifier bare.`,
      );
    }

    if (ticks % 2 === 1) {
      inLiteral = false;
      looksLikeSql = false;
    } else if (!looksLikeSql) {
      looksLikeSql = SQL.test(line);
    }
  });
}

if (problems.length > 0) {
  console.log(`${problems.length} thing(s) to look at:\n`);
  for (const problem of problems) console.log(`  ${problem}\n`);
  process.exit(1);
}

console.log('No backticks inside SQL template literals.');
