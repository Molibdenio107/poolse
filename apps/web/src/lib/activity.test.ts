import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { LABELLED_ACTIONS, formatActivityValue, type Translate } from './activity.ts';

// A fake `t` that shows which key it was asked for, and with what.
const t: Translate = (key, values) => (values ? `${key}:${JSON.stringify(values)}` : key);

test('an id reads as its name, and a row since deleted says so rather than showing the id', () => {
  assert.equal(formatActivityValue(t, 'levelId', { value: 'a-uuid', label: 'Golfinhos' }), 'Golfinhos');
  assert.equal(formatActivityValue(t, 'levelId', { value: 'a-uuid', label: null }), 'activity.value.gone');
});

test('nothing reads as a dash, and an unmarked register mark reads as unmarked', () => {
  assert.equal(formatActivityValue(t, 'capacity', { value: null, label: null }), 'activity.value.empty');
  assert.equal(formatActivityValue(t, 'status', { value: null, label: null }), 'activity.value.unmarked');
});

test('enums are words in the reader’s language, and a lane is a sentence with its number', () => {
  assert.equal(formatActivityValue(t, 'status', { value: 'excused', label: null }), 'attendance.excused');
  assert.equal(formatActivityValue(t, 'colour', { value: 'teal', label: null }), 'classes.colours.teal');
  assert.equal(formatActivityValue(t, 'lane', { value: 3, label: null }), 'activity.value.lane:{"lane":3}');
  assert.equal(formatActivityValue(t, 'capacity', { value: 12, label: null }), '12');
});

test('every labelled action has its sentence in both catalogues', () => {
  for (const locale of ['pt-PT', 'en']) {
    const messages = JSON.parse(
      readFileSync(new URL(`../messages/${locale}.json`, import.meta.url), 'utf8'),
    ) as { activity: { action: Record<string, Record<string, string>> } };
    for (const action of LABELLED_ACTIONS) {
      const [group, name] = action.split('.') as [string, string];
      assert.equal(typeof messages.activity.action[group]?.[name], 'string', `${locale}: ${action}`);
    }
  }
});
