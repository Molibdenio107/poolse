import { test } from 'node:test';
import assert from 'node:assert/strict';
import { attentionLines } from './attention-items.ts';

/** POOLSE-212: the bell's lines are the menu's counts, worded and linked. */

test('nothing to do lists nothing', () => {
  assert.deepEqual(attentionLines({}), []);
  assert.deepEqual(attentionLines({ classes: 0 }), []);
});

test("a sport's copy is the same things again and is not added; Pedidos are summed across sports", () => {
  const lines = attentionLines({ classes: 3, 'classes:pool': 3, leads: 1, 'leads:tennis': 2, students: 4, 'students:pool': 4 });
  assert.deepEqual(
    lines.map((line) => [line.kind, line.count]),
    [['classes', 3], ['leads', 3], ['students', 4]],
    'in the bell order: what blocks a lesson first',
  );
  assert.equal(lines[0]!.href, '/dashboard/classes?instructor=none');
});

test("in app mode a teacher's and maintenance's lines open their own homes", () => {
  const lines = attentionLines({ calendar: 2, facilities: 1 }, 'app');
  assert.deepEqual(lines.map((line) => line.href), ['/app/aulas', '/app/manutencao']);
  assert.equal(attentionLines({ calendar: 2 })[0]!.href, '/dashboard/calendar');
});

test('in app mode a line with no phone screen is not listed, and its count goes with it', () => {
  const lines = attentionLines({ calendar: 2, meetInbox: 3 }, 'app');
  assert.deepEqual(lines.map((line) => [line.kind, line.count]), [['calendar', 2]]);
  assert.equal(attentionLines({ meetInbox: 3 }).length, 1, 'the backoffice still lists it');
});
