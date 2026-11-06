import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { test, type Page } from '@playwright/test';

/**
 * The baseline — POOLSE-171. Not a test of anything: it **asserts no
 * threshold**. It loads six pages against whatever server is running, once
 * cold and three times warm, and records per page the time to first byte, DOM
 * content loaded, how many API calls the page made, the slowest of them, and
 * how many of the calls and queries were the `(app)` layout's own (`LAYOUT`) —
 * the ticket's "layout only" row, read off every page, because a route that
 * does not exist renders Next's not-found without the layout and so measures
 * nothing.
 *
 * The API calls happen on the Next server, out of the browser's sight, so they
 * are read from the API's own `PERF_LOG_FILE` (`common/server-timing.ts`): the
 * lines that landed between a load's start and end belong to it. One worker,
 * one page at a time, so nothing else writes in between.
 *
 * Run (the club seed loaded, the server started with PERF_LOG_FILE set):
 *
 *   PERF_LABEL=dev PERF_ORG_ID=… PERF_STUDENT_ID=… PERF_FACILITY_ID=… \
 *   PERF_LOG_FILE=… pnpm exec playwright test --project=perf
 *
 * Each run writes `docs/perf/runs/<date>-<label>.json`, and the table
 * `docs/perf/baseline-<date>.md` is rebuilt from every run of that date.
 */

const LABEL = process.env['PERF_LABEL'] ?? 'dev';
const ORG = process.env['PERF_ORG_ID'];
const STUDENT = process.env['PERF_STUDENT_ID'];
const FACILITY = process.env['PERF_FACILITY_ID'];
const LOG = process.env['PERF_LOG_FILE'];
const WARM = 3;
const DOCS = resolve(__dirname, '../../../docs/perf');

/**
 * The calls the `(app)` layout makes on every navigation, whatever the page.
 * Read off the first baseline's logs (04-11-2026); a call added to the layout
 * later lands in the page's column until it is listed here.
 */
const LAYOUT = new Set([
  '/me',
  '/shell',
  // Before POOLSE-172; kept so a run of an older commit still compares.
  '/settings/logo',
  '/subscription/alert',
  '/attention',
  '/meet-inbox/count',
  '/support-grants/status',
]);

interface Load {
  layoutCalls: number;
  layoutQueries: number;
  ttfb: number;
  dcl: number;
  apiCalls: number;
  apiLongest: number;
  apiLongestPath: string;
  apiDb: number;
  apiQueries: number;
}

interface Row {
  page: string;
  path: string;
  cold: Load;
  warm: Load;
}

const PAGES: { page: string; path: string }[] = [
  { page: 'Painel', path: '/dashboard' },
  { page: 'Alunos, page 2', path: '/dashboard/students?page=2' },
  { page: 'Student record', path: `/dashboard/students/${STUDENT ?? ''}` },
  { page: 'Calendário (this week)', path: '/dashboard/calendar' },
  { page: 'Pessoas', path: '/dashboard/facilities/staff' },
  { page: 'Site page', path: `/dashboard/facilities/${FACILITY ?? ''}` },
];

function apiLines(from: number, to: number): { path: string; total: number; db: number; queries: number }[] {
  if (!LOG || !existsSync(LOG)) return [];
  return readFileSync(LOG, 'utf-8')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line) as { at: number; path: string; total: number; db: number; queries: number })
    .filter((line) => line.at >= from && line.at <= to);
}

async function load(page: Page, path: string): Promise<Load> {
  const from = Date.now();
  await page.goto(path, { waitUntil: 'load', timeout: 180_000 });
  // The last API line is written on 'finish'; give the file a moment.
  await page.waitForTimeout(300);
  const to = Date.now();
  const nav = await page.evaluate(() => {
    const entry = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;
    return { ttfb: entry.responseStart - entry.startTime, dcl: entry.domContentLoadedEventEnd - entry.startTime };
  });
  const calls = apiLines(from, to);
  const longest = calls.reduce((best, one) => (one.total > best.total ? one : best), { path: '—', total: 0, db: 0, queries: 0 });
  const layout = calls.filter((one) => LAYOUT.has(one.path));
  return {
    layoutCalls: layout.length,
    layoutQueries: layout.reduce((sum, one) => sum + one.queries, 0),
    ttfb: Math.round(nav.ttfb),
    dcl: Math.round(nav.dcl),
    apiCalls: calls.length,
    apiLongest: longest.total,
    apiLongestPath: longest.path,
    apiDb: calls.reduce((sum, one) => sum + one.db, 0),
    apiQueries: calls.reduce((sum, one) => sum + one.queries, 0),
  };
}

function median(loads: Load[]): Load {
  const pick = (key: keyof Load) => {
    const sorted = loads.map((one) => one[key] as number).sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)]!;
  };
  const middle = [...loads].sort((a, b) => a.dcl - b.dcl)[Math.floor(loads.length / 2)]!;
  return {
    layoutCalls: pick('layoutCalls'),
    layoutQueries: pick('layoutQueries'),
    ttfb: pick('ttfb'),
    dcl: pick('dcl'),
    apiCalls: pick('apiCalls'),
    apiLongest: pick('apiLongest'),
    apiLongestPath: middle.apiLongestPath,
    apiDb: pick('apiDb'),
    apiQueries: pick('apiQueries'),
  };
}

function writeTable(date: string): void {
  const runs = readdirSync(resolve(DOCS, 'runs'))
    .filter((name) => name.startsWith(date) && name.endsWith('.json'))
    .sort();
  const lines = [
    `# Baseline — ${date}`,
    '',
    'POOLSE-171. Club seed (`pnpm --filter @poolse/db seed --size=club`, *Clube Medida*), the e2e owner as admin,',
    'desktop Chrome, one worker. **Cold** is the first load of that route since the server started; **warm** is',
    `the median of ${WARM} loads after it. Times in ms. API: calls the page's server made, the slowest and its`,
    'path, the database time and query count summed over them (`Server-Timing`), and how many of the calls and',
    "queries were the `(app)` layout's own (the same six on every page). No threshold is asserted.",
    '',
  ];
  for (const name of runs) {
    const run = JSON.parse(readFileSync(resolve(DOCS, 'runs', name), 'utf-8')) as { label: string; rows: Row[] };
    lines.push(`## ${run.label}`, '');
    lines.push(
      '| Page | TTFB cold | TTFB warm | DOM ready cold | DOM ready warm | API calls (layout) | Slowest call (warm) | DB ms / queries (warm) | Layout queries |',
      '|---|---:|---:|---:|---:|---:|---|---:|---:|',
    );
    for (const row of run.rows) {
      lines.push(
        `| ${row.page} | ${row.cold.ttfb} | ${row.warm.ttfb} | ${row.cold.dcl} | ${row.warm.dcl} | ` +
          `${row.warm.apiCalls} (${row.warm.layoutCalls}) | ${row.warm.apiLongest} \`${row.warm.apiLongestPath}\` | ` +
          `${row.warm.apiDb} / ${row.warm.apiQueries} | ${row.warm.layoutQueries} |`,
      );
    }
    lines.push('');
  }
  writeFileSync(resolve(DOCS, `baseline-${date}.md`), `${lines.join('\n')}\n`);
}

test('POOLSE-171 baseline', async ({ page, context }) => {
  test.skip(!ORG || !STUDENT || !FACILITY, 'Set PERF_ORG_ID, PERF_STUDENT_ID and PERF_FACILITY_ID (the club seed).');
  test.setTimeout(30 * 60_000);

  // The club being measured, the way the club switcher picks it.
  const base = new URL(process.env['E2E_BASE_URL'] ?? 'http://localhost:3000');
  await context.addCookies([{ name: 'poolse_org', value: ORG!, domain: base.hostname, path: '/' }]);

  const rows: Row[] = [];
  for (const one of PAGES) {
    const cold = await load(page, one.path);
    const warm: Load[] = [];
    for (let index = 0; index < WARM; index += 1) warm.push(await load(page, one.path));
    rows.push({ ...one, cold, warm: median(warm) });
  }

  const date = new Date().toISOString().slice(0, 10);
  mkdirSync(resolve(DOCS, 'runs'), { recursive: true });
  // The label is prose; the file name is not.
  const file = `${date}-${LABEL.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}.json`;
  writeFileSync(resolve(DOCS, 'runs', file), `${JSON.stringify({ label: LABEL, rows }, null, 2)}\n`);
  writeTable(date);
});
