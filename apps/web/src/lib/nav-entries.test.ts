import { test } from 'node:test';
import assert from 'node:assert/strict';
import { POOLSE_MODULES } from '@poolse/rules';
import { visibleSections, type Item, type Viewer } from './nav-entries.ts';
import { commandsFor } from './commands.ts';

/**
 * One menu group per sport — POOLSE-125, and since POOLSE-150 a business club
 * with one sport gets its one group too, holding what a multi-sport club's does.
 */

const owner: Viewer = { roles: ['owner'], kind: 'business', modules: [...POOLSE_MODULES] };

const flat = (items: Item[]): Item[] => items.flatMap((item) => [item, ...flat(item.children ?? [])]);

test('POOLSE-150 QA 1: swimming alone gets its one Natação group, holding Calendário, Turmas and Piscinas', () => {
  const sections = visibleSections({ ...owner, sports: ['pool'] });
  assert.deepEqual(sections, visibleSections(owner), 'no sports given is swimming');
  const groups = sections.filter((item) => item.key.startsWith('sport.name.'));
  assert.deepEqual(groups.map((group) => group.key), ['sport.name.pool']);
  assert.deepEqual(
    groups[0]!.children?.map((item) => [item.href, item.key]),
    [
      ['/dashboard/calendar?sport=pool', 'calendar.title'],
      ['/dashboard/classes?sport=pool', 'classes.title'],
      ['/dashboard/recintos?sport=pool', 'recintos.nav.pool'],
      ['/dashboard/students?sport=pool', 'students.title'],
    ],
  );
  // Turmas and Calendário left the top level, as with two sports.
  const top = sections.map((item) => item.href);
  assert.equal(top.includes('/dashboard/classes') || top.includes('/dashboard/calendar'), false);
});

test('POOLSE-150: a personal tenant keeps its menu — it has no per-sport entries', () => {
  const personal = visibleSections({ roles: ['owner'], kind: 'personal', modules: [...POOLSE_MODULES], sports: ['pool'] });
  assert.equal(personal.some((item) => item.key.startsWith('sport.name.')), false);
});

test('POOLSE-150: each sport names its recintos in its own word', () => {
  const sections = visibleSections({ ...owner, sports: ['pool', 'tennis', 'gym'] });
  const word = (sport: string): string | undefined =>
    sections.find((item) => item.sport === sport)?.children?.find((item) => item.href.startsWith('/dashboard/recintos'))?.key;
  assert.deepEqual([word('pool'), word('tennis'), word('gym')], ['recintos.nav.pool', 'recintos.nav.courts', 'recintos.nav.rooms']);
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
    ['/dashboard/calendar?sport=tennis', '/dashboard/classes?sport=tennis', '/dashboard/recintos?sport=tennis', '/dashboard/students?sport=tennis'],
  );
  // A sport's tab opens its Calendário (POOLSE-141 rule 3, the handoff's sidebar).
  assert.equal(tennisGroup.href, '/dashboard/calendar?sport=tennis');
  // The pool keeps Épocas, Reposições, Encerramentos and its circle; a court's group has neither yet.
  const poolCalendar = poolGroup.children?.find((item) => item.key === 'calendar.title');
  assert.equal(poolCalendar?.badge, 'calendar');
  assert.ok((poolCalendar?.children ?? []).length > 0);
  // Only Pedidos carries a circle in a court's group, and it is that sport's own (POOLSE-143).
  assert.deepEqual(
    flat(tennisGroup.children ?? []).filter((item) => item.badge !== undefined).map((item) => [item.badge, item.badgePerSport]),
    [['leads', true]],
  );
  const tennisTurmas = tennisGroup.children?.find((item) => item.key === 'classes.title');
  assert.deepEqual(tennisTurmas?.children, [], 'Épocas and Reposições read no sport yet');
});

test('POOLSE-143: Alunos is shared and copied; Níveis, Avanços and Competição move; Competição is swimming only', () => {
  const sections = visibleSections({ ...owner, sports: ['pool', 'tennis'] });
  const shared = sections.find((item) => item.key === 'students.title' && item.sport === undefined);
  assert.deepEqual(
    shared?.children?.map((item) => item.key),
    ['students.guardiansTitle', 'leads.title', 'messages.title'],
    'the shared register keeps what has no sport dimension, and Pedidos',
  );
  const studentsOf = (sport: string): Item | undefined =>
    sections.find((item) => item.sport === sport)?.children?.find((item) => item.key === 'students.title');
  assert.deepEqual(
    studentsOf('pool')?.children?.map((item) => item.href),
    [
      '/dashboard/students/pedidos?sport=pool',
      '/dashboard/students/provas?sport=pool',
      '/dashboard/students/levels?sport=pool',
      '/dashboard/students/advancement?sport=pool',
    ],
  );
  assert.deepEqual(
    studentsOf('tennis')?.children?.map((item) => item.href),
    [
      '/dashboard/students/pedidos?sport=tennis',
      '/dashboard/students/levels?sport=tennis',
      '/dashboard/students/advancement?sport=tennis',
    ],
    'no Competição for a sport without a model',
  );
  // POOLSE-150: swimming alone has its group too, so Níveis is in its Alunos copy.
  const poolOnly = visibleSections(owner)
    .find((item) => item.sport === 'pool')
    ?.children?.find((item) => item.key === 'students.title');
  assert.equal(poolOnly?.children?.some((item) => item.key === 'students.levels'), true);
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
