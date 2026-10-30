import { test } from 'node:test';
import assert from 'node:assert/strict';
import { POOLSE_MODULES } from '@poolse/rules';
import { visibleSections, type Item, type Viewer } from './nav-entries.ts';
import { commandsFor } from './commands.ts';

/**
 * One menu group per sport — POOLSE-125. The pool-only menu is the one that
 * shipped; a second sport moves Turmas and Calendário into a group per sport.
 */

const owner: Viewer = { roles: ['owner'], kind: 'business', modules: [...POOLSE_MODULES] };

const flat = (items: Item[]): Item[] => items.flatMap((item) => [item, ...flat(item.children ?? [])]);

test('QA 1: with swimming alone the menu is exactly the one with no sports given', () => {
  const before = visibleSections(owner);
  const after = visibleSections({ ...owner, sports: ['pool'] });
  assert.deepEqual(after, before);
  assert.equal(flat(after).some((item) => item.sport !== undefined || item.href.includes('?')), false);
  assert.deepEqual(
    after.map((item) => item.href).filter((href) => href === '/dashboard/classes' || href === '/dashboard/calendar'),
    ['/dashboard/classes', '/dashboard/calendar'],
  );
});

test('QA 2: with two sports each gets a group, in order, where Turmas stood, and the shared entries stay', () => {
  const sections = visibleSections({ ...owner, sports: ['pool', 'tennis'] });
  const keys = sections.map((item) => item.key);
  assert.equal(keys.includes('classes.title'), false, 'Turmas left the top level');
  assert.equal(keys.includes('calendar.title'), false, 'Calendário left the top level');
  const pool = keys.indexOf('sport.name.pool');
  const tennis = keys.indexOf('sport.name.tennis');
  assert.ok(pool !== -1 && tennis === pool + 1, 'the pool, then tennis, side by side');
  assert.ok(keys.indexOf('energy.section') < pool && keys.indexOf('reception.title') > tennis);

  const [poolGroup, tennisGroup] = [sections[pool], sections[tennis]] as [Item, Item];
  assert.deepEqual(
    tennisGroup.children?.map((item) => item.href),
    ['/dashboard/classes?sport=tennis', '/dashboard/calendar?sport=tennis'],
  );
  assert.equal(tennisGroup.href, '/dashboard/classes?sport=tennis');
  // The pool keeps Épocas, Reposições, Encerramentos and its circle; a court's group has neither yet.
  const poolCalendar = poolGroup.children?.find((item) => item.key === 'calendar.title');
  assert.equal(poolCalendar?.badge, 'calendar');
  assert.ok((poolCalendar?.children ?? []).length > 0);
  assert.equal(flat(tennisGroup.children ?? []).some((item) => item.badge !== undefined), false);
  assert.equal(flat(tennisGroup.children ?? []).some((item) => (item.children ?? []).length > 0), false);
});

test('a role that may not see Turmas gets no empty sport group', () => {
  const guardian = visibleSections({ roles: ['guardian'], kind: 'business', modules: [...POOLSE_MODULES], sports: ['pool', 'padel'] });
  assert.equal(guardian.some((item) => item.key.startsWith('sport.name.')), false);
});

test('QA 5: the palette lists each sport’s calendar as its own entry, and no group heading', () => {
  const commands = commandsFor({ ...owner, sports: ['pool', 'tennis'] });
  const calendars = commands.filter((command) => command.labelKey === 'calendar.title');
  assert.deepEqual(
    calendars.map((command) => command.sportKey),
    ['sport.name.pool', 'sport.name.tennis'],
  );
  assert.equal(commands.some((command) => command.labelKey.startsWith('sport.name.')), false);
});
