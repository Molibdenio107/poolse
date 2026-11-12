import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkedSchema, replySchemaProblems, ReplySchemaError, MAX_OPTIONAL } from './ai-schema.ts';

const object = (fields: string[], required: string[]) => ({
  type: 'object',
  properties: Object.fromEntries(fields.map((f) => [f, { type: 'string' }])),
  required,
  additionalProperties: false,
});
const many = Array.from({ length: 22 }, (_, i) => `f${i}`);

test('22 optional fields — what the water reader sent on 12-11-2026 — are refused', () => {
  const schema = { type: 'object', properties: { rows: { type: 'array', items: object(many, []) } }, required: ['rows'], additionalProperties: false };
  assert.match(replySchemaProblems(schema).join(), /22 optional/);
  assert.throws(() => checkedSchema('water_report', schema), ReplySchemaError);
});

test('the same fields, all required, pass', () => {
  const schema = { type: 'object', properties: { rows: { type: 'array', items: object(many, many) } }, required: ['rows'], additionalProperties: false };
  assert.deepEqual(replySchemaProblems(schema), []);
});

test(`up to ${MAX_OPTIONAL} optional fields pass`, () => {
  assert.deepEqual(replySchemaProblems(object(many.slice(0, MAX_OPTIONAL), [])), []);
});

test('a nullable enum written as a type list is refused, and as anyOf passes', () => {
  const bad = { type: 'object', properties: { kind: { type: ['string', 'null'], enum: ['cc', 'bi', null] } }, required: ['kind'], additionalProperties: false };
  assert.match(replySchemaProblems(bad).join(), /enum/);
  const good = { type: 'object', properties: { kind: { anyOf: [{ type: 'string', enum: ['cc', 'bi'] }, { type: 'null' }] } }, required: ['kind'], additionalProperties: false };
  assert.deepEqual(replySchemaProblems(good), []);
});

test('an object without additionalProperties: false is refused', () => {
  assert.match(replySchemaProblems({ type: 'object', properties: { a: { type: 'string' } }, required: ['a'] }).join(), /additionalProperties/);
});
