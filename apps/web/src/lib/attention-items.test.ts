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

test('the site circles are named one line per thing, each opening the tab that holds it (Rui, 11-11-2026)', () => {
  const places = [
    { kind: 'water' as const, facilityId: 'f1', poolId: 'p1', spaceId: null, name: 'Piscina principal', count: 1 },
    { kind: 'task' as const, facilityId: 'f1', poolId: 'p1', spaceId: null, name: 'Piscina principal', count: 2 },
    { kind: 'fault' as const, facilityId: 'f1', poolId: null, spaceId: 's1', name: 'Balneário', count: 1 },
  ];
  const lines = attentionLines({ classes: 1, facilities: 3 }, 'backoffice', places);
  assert.deepEqual(
    lines.map((line) => [line.key, line.name, line.count, line.href]),
    [
      ['notifications.item.classes', undefined, 1, '/dashboard/classes?instructor=none'],
      ['notifications.place.water', 'Piscina principal', 1, '/dashboard/facilities/pools/p1?tab=water'],
      ['notifications.place.task', 'Piscina principal', 2, '/dashboard/facilities/f1?tab=maintenance'],
      ['notifications.place.fault', 'Balneário', 1, '/dashboard/facilities/spaces/s1?tab=issues'],
    ],
  );
  assert.equal(new Set(lines.map((line) => line.id)).size, lines.length, 'each line its own key');
  // On the phone, maintenance's home holds them all.
  assert.deepEqual(
    attentionLines({ facilities: 3 }, 'app', places).map((line) => line.href),
    ['/app/manutencao', '/app/manutencao', '/app/manutencao'],
  );
  // Without names (an older API), the one summary line is kept.
  assert.equal(attentionLines({ facilities: 3 })[0]!.key, 'notifications.item.facilities');
});

test('lessons are named one line each, opening the lesson itself; past five, one line to the calendar (Rui, 11-11-2026)', () => {
  const lesson = (n: number, partner = false) => ({
    sessionId: `s${n}`,
    name: `Turma ${n}`,
    partner,
    localDate: '2026-11-12',
    localTime: '18:00',
    weekStart: '2026-11-09',
    count: 1,
  });
  const lessons = [lesson(1), lesson(2, true), lesson(3), lesson(4), lesson(5), lesson(6), lesson(7)];
  const lines = attentionLines({ calendar: 7 }, 'backoffice', [], lessons);
  assert.equal(lines.length, 6);
  assert.deepEqual(
    [lines[0]!.key, lines[0]!.name, lines[0]!.date, lines[0]!.time, lines[0]!.href],
    ['notifications.lesson', 'Turma 1', '2026-11-12', '18:00', '/dashboard/calendar/sessions/s1?week=2026-11-09'],
  );
  assert.deepEqual([lines[5]!.key, lines[5]!.count, lines[5]!.href], ['notifications.lessonsMore', 2, '/dashboard/calendar']);
  // On the phone a turma's lesson is the app's own screen; a partnership's hour keeps the backoffice page.
  const app = attentionLines({ calendar: 7 }, 'app', [], lessons);
  assert.equal(app[0]!.href, '/app/aulas/s1');
  assert.equal(app[1]!.href, '/dashboard/calendar/sessions/s2?week=2026-11-09');
});

test('every summary line opens the place its problem is listed, not a section page', () => {
  assert.equal(attentionLines({ meetInbox: 2 })[0]!.href, '/dashboard/students/provas/recebidos');
});
