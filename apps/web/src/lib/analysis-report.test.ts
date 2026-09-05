import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readRows, reportMediaType } from './analysis-report.ts';

/**
 * Round 6, ticket 1 — what comes back from reading a report.
 *
 * The model call itself is not tested here and deliberately so: it needs a key,
 * costs money, and its answer is not deterministic. What *is* worth testing is
 * the layer that decides how much of that answer to believe — because that is
 * the layer standing between an extracted number and a pool's safety record.
 *
 * The rule it enforces is one sentence: a strict tool schema makes a malformed
 * answer unlikely, and this makes one harmless. Those are different properties,
 * and only the second survives a model, an SDK version or a prompt changing.
 *
 * Run: pnpm web:test
 */

test('a report reads back as rows in the importer own field names', () => {
  const rows = readRows({
    analyses: [
      { takenOn: '01/09/2026', takenTime: '08:30', ph: '7,4', free_chlorine: '1,2' },
      { takenOn: '02/09/2026', ph: '7,3' },
    ],
  });

  assert.equal(rows.length, 2);
  // The decimal comma survives. `parseReading` on the API is what turns it into
  // a number, and it is the only place that should — a converter here would be
  // a second answer to "what is 7,4".
  assert.deepEqual(rows[0], {
    takenOn: '01/09/2026',
    takenTime: '08:30',
    ph: '7,4',
    free_chlorine: '1,2',
  });
  assert.deepEqual(rows[1], { takenOn: '02/09/2026', ph: '7,3' });
});

test('a field nobody offered is dropped rather than carried', () => {
  // The failure this guards against is not a model inventing a field. It is a
  // field arriving that the API would then have to decide what to do with — and
  // an importer that forwards unknown keys is an importer whose contract is
  // whatever the model said last time.
  const rows = readRows({
    analyses: [{ takenOn: '2026-09-01', ph: '7,4', chloramine_index: '3', notes: 'Tudo normal' }],
  });

  assert.deepEqual(rows, [{ takenOn: '2026-09-01', ph: '7,4', notes: 'Tudo normal' }]);
});

test('a number is as good an answer as a string, and nothing else is', () => {
  const rows = readRows({
    analyses: [{ takenOn: '2026-09-01', ph: 7.4, temperature: null, salt: { value: 3200 } }],
  });

  assert.deepEqual(rows, [{ takenOn: '2026-09-01', ph: '7.4' }]);
});

test('an empty analysis is dropped, not previewed as a blank line', () => {
  const rows = readRows({
    analyses: [{}, { ph: '   ' }, { takenOn: '2026-09-01', ph: '7,4' }],
  });

  assert.equal(rows.length, 1, 'only the one with something on it');
});

test('an answer that is not an answer produces no rows and no exception', () => {
  // Every one of these is a real failure mode: a refusal in prose, a truncated
  // response, an SDK returning the block differently. None of them may reach the
  // operator as a crash.
  assert.deepEqual(readRows(null), []);
  assert.deepEqual(readRows('I could not read this document'), []);
  assert.deepEqual(readRows({}), []);
  assert.deepEqual(readRows({ analyses: 'none' }), []);
  assert.deepEqual(readRows({ analyses: [null, 3, 'x'] }), []);
});

test('the file type decides which reader sees a file', () => {
  // A spreadsheet is not a report and must not be sent to a model; a report has
  // no columns and must not be sent to the mapping step. This function is the
  // whole of that decision.
  assert.equal(reportMediaType('Boletim 2026-09-01.pdf'), 'application/pdf');
  assert.equal(reportMediaType('IMG_4821.JPG'), 'image/jpeg');
  assert.equal(reportMediaType('analise.jpeg'), 'image/jpeg');
  assert.equal(reportMediaType('foto.webp'), 'image/webp');

  assert.equal(reportMediaType('registo-agua.xlsx'), null);
  assert.equal(reportMediaType('registo-agua.csv'), null);
  // A name that merely contains an extension is not that extension.
  assert.equal(reportMediaType('relatorio.pdf.xlsx'), null);
});
