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
 * ---------------------------------------------------------------------------
 * Two passes, since round 5 — and why the first version was not enough
 * ---------------------------------------------------------------------------
 *
 * The original walked the file once and decided "is this literal SQL?" by
 * testing the line the literal *opened on*. That misses the shape this codebase
 * actually writes most often:
 *
 *     await tx.query(
 *       `
 *       SELECT ...
 *
 * The opening line is a bare backtick with no keyword on it, so the literal was
 * never recognised as SQL and a backtick three lines down went unreported. It
 * let exactly that through in ticket 10.3: a comment containing a quoted column
 * name passed this check, and the TypeScript parse error is what caught it —
 * which is the failure mode this script exists to prevent.
 *
 * So: find each literal's extent first, ask whether SQL appears **anywhere**
 * inside it, and only then look for the offending lines. A keyword after the
 * comment counts just as much as one before it.
 *
 * ---------------------------------------------------------------------------
 * The self-test
 * ---------------------------------------------------------------------------
 *
 * This runs its own fixtures before it scans anything, every time. A guard that
 * has never been shown to fail is a guard nobody should trust — and this one
 * silently stopped working for at least one shape without anybody noticing. The
 * fixtures cost a millisecond and mean the check can no longer rot quietly.
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

/**
 * Every template literal in the file, as a line range.
 *
 * Parity, not parsing. A line with an odd number of backticks opens or closes a
 * literal; an even number leaves the state alone. That is crude and it is enough,
 * because the bug being hunted — a quoted identifier in a comment — always
 * writes backticks in pairs and so never disturbs the count.
 *
 * It cannot see a literal inside a string, or an escaped backtick. Both are
 * vanishingly rare in this codebase and a false positive costs one glance,
 * which is the trade the original made and the right one.
 */
function literalsIn(lines) {
  const found = [];
  let open = null;

  lines.forEach((line, index) => {
    const ticks = (line.match(/`/g) ?? []).length;
    if (ticks % 2 === 0) return;

    if (open === null) open = index;
    else {
      found.push({ from: open, to: index });
      open = null;
    }
  });

  // A literal still open at the end of the file is one the parity could not
  // pair up. Reported to its last line rather than dropped: an unclosed literal
  // is itself worth looking at.
  if (open !== null) found.push({ from: open, to: lines.length - 1 });
  return found;
}

/**
 * The lines that end a SQL literal early, in one file.
 *
 * Exported shape rather than printed here, so the self-test below can call it
 * with fixtures instead of writing files to disk.
 */
function scan(lines) {
  const problems = [];

  for (const { from, to } of literalsIn(lines)) {
    const body = lines.slice(from, to + 1);

    // Pass one: is this a SQL literal at all? Anywhere inside it counts.
    if (!body.some((line) => SQL.test(line))) continue;

    // Pass two: a prose line carrying a backtick pair closes and reopens the
    // string mid-statement. The `*` prefix is what distinguishes a comment from
    // SQL that legitimately mentions one.
    body.forEach((line, offset) => {
      const ticks = (line.match(/`/g) ?? []).length;
      if (ticks >= 2 && /^\s*\*/.test(line)) {
        problems.push({ line: from + offset + 1, opened: from + 1, text: line.trim() });
      }
    });
  }

  return problems;
}

// ---------------------------------------------------------------------------
// The self-test
// ---------------------------------------------------------------------------

const TICK = '`';

/** Each fixture is [name, lines, howManyProblemsExpected]. */
const FIXTURES = [
  [
    'the shape that got through in 10.3 — a bare opening backtick, comment before the keyword',
    [
      '  await tx.query(',
      `    ${TICK}`,
      '    /*',
      `     * A note about ${TICK}starts_on${TICK}, which closes the literal.`,
      '     */',
      '    SELECT 1',
      `    ${TICK},`,
      '  );',
    ],
    1,
  ],
  [
    'the shape the original already caught — keyword on the opening line',
    [
      `  await tx.query(${TICK}SELECT 1`,
      `     * mentions ${TICK}a_table${TICK} in prose`,
      `    ${TICK});`,
    ],
    1,
  ],
  [
    'a SQL literal with no backticks in it is fine',
    [`  await tx.query(${TICK}`, '    SELECT 1', '    FROM student', `  ${TICK});`],
    0,
  ],
  [
    'a non-SQL literal may quote whatever it likes',
    [
      `  const message = ${TICK}`,
      `     * see ${TICK}field.tsx${TICK} for the shared control`,
      `  ${TICK};`,
    ],
    0,
  ],
  [
    'SQL that legitimately mentions a quoted identifier outside a comment is not flagged',
    [`  await tx.query(${TICK}`, "    SELECT 1 -- no backticks here", `  ${TICK});`],
    0,
  ],
];

function selfTest() {
  const failures = [];

  for (const [name, lines, expected] of FIXTURES) {
    const found = scan(lines).length;
    if (found !== expected) failures.push(`  ${name}\n    expected ${expected}, found ${found}`);
  }

  if (failures.length > 0) {
    console.log('The check is broken. Its own fixtures do not pass:\n');
    for (const failure of failures) console.log(`${failure}\n`);
    process.exit(2);
  }
}

selfTest();

// ---------------------------------------------------------------------------
// The scan
// ---------------------------------------------------------------------------

const problems = [];

for (const file of walk(ROOT)) {
  for (const found of scan(readFileSync(file, 'utf8').split('\n'))) {
    problems.push(
      `${file}:${found.line}\n` +
        `    a backtick inside a SQL template literal (opened line ${found.opened})\n` +
        `    ${found.text}\n` +
        `    -> the first one ends the string. Write the identifier bare.`,
    );
  }
}

if (problems.length > 0) {
  console.log(`${problems.length} thing(s) to look at:\n`);
  for (const problem of problems) console.log(`  ${problem}\n`);
  process.exit(1);
}

console.log(`No backticks inside SQL template literals (${FIXTURES.length} fixtures pass).`);
