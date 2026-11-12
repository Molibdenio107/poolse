// The timetable reader against its corpus — POOLSE-223.
//
// Reads every case in test-fixtures/timetables/ with the real model, the app's
// own prompt and schema (`lib/timetable-reader-prompt.ts`) and the app's own
// narrowing (`lib/timetable-reading.ts`), and compares with `expected.json`.
//
// **It calls the model and costs money.** Never in CI. Run by hand before a
// change to the reader ships, and record the result in the PR. The pass bar:
// every expected row found, and no closed or legend row read as an activity.
//
// Run: pnpm timetable:eval [case-name-fragment]

import Anthropic from '@anthropic-ai/sdk';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SCHEMA, SYSTEM } from '../src/lib/timetable-reader-prompt.ts';
import { narrowReading } from '../src/lib/timetable-reading.ts';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', 'test-fixtures', 'timetables');
const MODEL = process.env.POOLSE_PDF_TABLE_MODEL ?? 'claude-opus-5-5';
const only = process.argv[2] ?? '';

const MEDIA = { 'timetable.pdf': 'application/pdf', 'timetable.jpg': 'image/jpeg', 'timetable.png': 'image/png' };

const fold = (text) =>
  String(text ?? '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/**
 * Pools match when one folded name holds the other. Where the document names no
 * pool (expected ''), whatever the reader called it is accepted: "a piscina de
 * 25 m" in a footer is a defensible name, and the person maps it anyway.
 */
const samePool = (got, want) =>
  fold(want) === '' || fold(got) === fold(want) || (fold(got) !== '' && (fold(got).includes(fold(want)) || fold(want).includes(fold(got))));

/** Lane names as the positions they mean: "Pistas 1-3" and "1-3" are both 1,2,3. */
const positions = (names) => {
  const out = new Set();
  for (const name of names ?? []) {
    for (const match of String(name).matchAll(/(\d+)(?:\s*(?:-|–|a)\s*(\d+))?/g)) {
      const from = Number(match[1]);
      const to = match[2] === undefined ? from : Number(match[2]);
      for (let at = from; at <= to && at - from < 50; at += 1) out.add(at);
    }
  }
  return [...out].sort((a, b) => a - b).join(',');
};

const key = (row) =>
  `${row.weekday}|${row.start}|${row.end}|${row.closed ? '#closed' : fold(row.activity)}|${row.lanes ?? '-'}|${positions(row.laneNames)}`;

async function read(client, bytes, media) {
  const data = bytes.toString('base64');
  const source =
    media === 'application/pdf'
      ? { type: 'document', source: { type: 'base64', media_type: media, data } }
      : { type: 'image', source: { type: 'base64', media_type: media, data } };
  const response = await client.beta.messages
    .stream(
      {
        model: MODEL,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        max_tokens: 64000,
        system: SYSTEM,
        messages: [{ role: 'user', content: [source, { type: 'text', text: 'Read this timetable into rows.' }] }],
        output_config: { effort: 'high', format: { type: 'json_schema', schema: SCHEMA } },
      },
      { timeout: 300_000 },
    )
    .finalMessage();
  if (response.stop_reason !== 'end_turn') throw new Error(`stopped: ${response.stop_reason}`);
  const text = response.content.filter((block) => block.type === 'text').map((block) => block.text).join('');
  return { reading: narrowReading(JSON.parse(text)), usage: response.usage };
}

function compare(expected, actual) {
  const left = [...actual.rows];
  const missed = [];
  for (const want of expected.rows) {
    const at = left.findIndex((got) => key(got) === key(want) && samePool(got.sourcePool, want.sourcePool));
    if (at === -1) missed.push(want);
    else left.splice(at, 1);
  }
  const closedAsActivity = actual.rows.filter((row) => !row.closed && /^(encerrad|fechad|closed)/i.test(fold(row.activity)));
  return { missed, extra: left, closedAsActivity };
}

const client = new Anthropic();
const cases = readdirSync(root, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && entry.name.includes(only))
  .map((entry) => entry.name)
  .sort();

let failed = 0;
const table = [];
for (const name of cases) {
  const folder = join(root, name);
  const file = Object.keys(MEDIA).find((candidate) => existsSync(join(folder, candidate)));
  if (file === undefined) continue;
  const expected = JSON.parse(readFileSync(join(folder, 'expected.json'), 'utf8'));
  const started = Date.now();
  try {
    const { reading, usage } = await read(client, readFileSync(join(folder, file)), MEDIA[file]);
    const { missed, extra, closedAsActivity } = compare(expected, reading);
    const found = expected.rows.length - missed.length;
    const pass = missed.length === 0 && closedAsActivity.length === 0 && extra.every((row) => row.closed);
    if (!pass) failed += 1;
    table.push({
      case: name,
      recall: `${found}/${expected.rows.length}`,
      precision: `${reading.rows.length - extra.length}/${reading.rows.length}`,
      validity: reading.validity === null ? '—' : 'read',
      tokens: `${usage.input_tokens}+${usage.output_tokens}`,
      seconds: Math.round((Date.now() - started) / 1000),
      result: pass ? 'PASS' : 'FAIL',
    });
    for (const row of missed) console.log(`  ${name} missed: ${row.sourcePool} ${key(row)}`);
    for (const row of extra) console.log(`  ${name} extra:  ${row.sourcePool} ${key(row)}`);
    for (const row of closedAsActivity) console.log(`  ${name} closed read as activity: ${key(row)}`);
  } catch (error) {
    failed += 1;
    table.push({ case: name, recall: '—', precision: '—', validity: '—', tokens: '—', seconds: Math.round((Date.now() - started) / 1000), result: `ERROR ${error.message}` });
  }
}

console.table(table);
process.exitCode = failed === 0 ? 0 : 1;
