import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AI_READERS, effectiveAiReaders, estimateReadCents, estimateReadsCents, USD_TO_EUR } from './ai.js';

/** POOLSE-137 — which readers run, and what they are estimated to cost. */

test('a reader runs only when the club ticked it and the platform switched it on', () => {
  const switches = { energy_invoice_ai: true, pdf_table_ai: false, id_document_ai: true };
  assert.deepEqual(effectiveAiReaders(['pdf_table', 'energy_invoice'], switches), ['energy_invoice']);
  assert.deepEqual(effectiveAiReaders([], switches), []);
  // A switch with no row is off.
  assert.deepEqual(effectiveAiReaders(['column_match'], switches), []);
  assert.deepEqual(effectiveAiReaders([...AI_READERS, 'curling'], { id_document_ai: true }), ['id_document']);
});

test('a priced call is tokens times the rate, in euro cents', () => {
  // Opus 5.5: $4 in, $20 out per million. 1M in + 0.1M out = $6.
  const cents = estimateReadCents({ model: 'claude-opus-5-5', inputTokens: 1_000_000, outputTokens: 100_000 });
  assert.ok(cents !== null);
  assert.ok(Math.abs(cents - 6 * USD_TO_EUR * 100) < 1e-9);
});

test('an unpriced model or missing tokens is unknown, never zero', () => {
  assert.equal(estimateReadCents({ model: 'claude-future-9', inputTokens: 10, outputTokens: 10 }), null);
  assert.equal(estimateReadCents({ model: 'claude-opus-5-5', inputTokens: null, outputTokens: null }), null);
});

test('a total reports its coverage, and one unpriced model blanks it', () => {
  const total = estimateReadsCents([
    { model: 'claude-haiku-5-5', inputTokens: 2_000_000, outputTokens: 0, count: 3 },
    { model: null, inputTokens: null, outputTokens: null, count: 2 },
  ]);
  assert.equal(total.reads, 5);
  assert.equal(total.measured, 3);
  assert.ok(total.cents !== null && Math.abs(total.cents - 0.2 * USD_TO_EUR * 100) < 1e-9);

  const blank = estimateReadsCents([
    { model: 'claude-haiku-5-5', inputTokens: 10, outputTokens: 10 },
    { model: 'claude-future-9', inputTokens: 10, outputTokens: 10 },
  ]);
  assert.equal(blank.cents, null);
});
