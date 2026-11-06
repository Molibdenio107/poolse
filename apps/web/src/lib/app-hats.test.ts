import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TABS, appHome, familyOnly, hatsOf, tabFor } from './app-hats.ts';

/**
 * Who lands where in app mode — POOLSE-90, QA 1 and 2. The router, the switcher
 * and the dashboard's redirect all read this, so it is pinned once here.
 */

test('an owner or admin is sent to the backoffice, whatever else they are', () => {
  assert.equal(appHome(['owner']), '/dashboard');
  assert.equal(appHome(['admin', 'guardian']), '/dashboard');
});

test('a guardian or a student lands on the family agenda', () => {
  assert.equal(appHome(['guardian']), '/app/familia');
  assert.equal(appHome(['student']), '/app/familia');
});

test('an instructor who is a parent has both homes, teaching first (QA 2)', () => {
  const hats = hatsOf(['instructor', 'guardian']);
  assert.deepEqual(hats.homes, ['teaching', 'family']);
  assert.equal(hats.staff, true);
  assert.equal(familyOnly(['instructor', 'guardian']), false);
});

test('an instructor lands on their lessons, maintenance on the to-do list (slices 2 and 3)', () => {
  assert.equal(appHome(['instructor']), '/app/aulas');
  assert.equal(appHome(['maintenance']), '/app/manutencao');
});

test('a family and nothing else is family-only', () => {
  assert.equal(familyOnly(['guardian']), true);
  assert.equal(familyOnly(['guardian', 'student']), true);
  assert.equal(familyOnly([]), false);
});


// POOLSE-136 — which bar a screen wears, and which tab is current.
const q = (query = '') => new URLSearchParams(query);

test("a home's own tabs carry the bar; a screen deeper in does not", () => {
  assert.deepEqual(tabFor('/app/familia', q(), ['family', 'teaching']), { hat: 'family', index: 0 });
  assert.deepEqual(tabFor('/app/familia/aulas', q('child=x'), ['family', 'teaching']), { hat: 'family', index: 1 });
  assert.deepEqual(tabFor('/app/familia/marcas', q(), ['family', 'teaching']), { hat: 'family', index: 2 });
  assert.equal(tabFor('/app/familia/pagamentos', q(), ['family', 'teaching']), null, 'on Perfil since 06-11-2026');
  assert.equal(tabFor('/app/familia/aulas/abc', q(), ['family', 'teaching']), null);
  assert.equal(tabFor('/app/familia/inscrever', q(), ['family', 'teaching']), null);
  assert.equal(tabFor('/app/manutencao/reportar', q(), ['maintenance']), null);
});

test('Hoje and Semana are one page; Perfil wears the home it was opened from', () => {
  assert.deepEqual(tabFor('/app/aulas', q(), ['teaching']), { hat: 'teaching', index: 0 });
  assert.deepEqual(tabFor('/app/aulas', q('semana'), ['teaching']), { hat: 'teaching', index: 1 });
  assert.deepEqual(tabFor('/app/perfil', q('home=family'), ['teaching', 'family']), { hat: 'family', index: 3 });
  assert.deepEqual(tabFor('/app/perfil', q(), ['teaching', 'family']), { hat: 'teaching', index: 2 });
  // POOLSE-181: maintenance has its own bar, and Perfil wears it.
  assert.deepEqual(tabFor('/app/perfil', q(), ['maintenance']), { hat: 'maintenance', index: 2 });
  assert.deepEqual(tabFor('/app/perfil', q('home=maintenance'), ['teaching', 'maintenance']), { hat: 'maintenance', index: 2 });
  assert.deepEqual(tabFor('/app/manutencao', q(), ['maintenance']), { hat: 'maintenance', index: 0 });
  assert.deepEqual(tabFor('/app/manutencao/registar', q(), ['maintenance']), { hat: 'maintenance', index: 1 });
  // A home the reader does not have is ignored, never drawn.
  assert.deepEqual(tabFor('/app/perfil', q('home=family'), ['teaching']), { hat: 'teaching', index: 2 });
});

test('the family has four tabs and the instructor three, Perfil last (Rui, 31-10-2026)', () => {
  assert.equal(TABS.family.length, 4);
  assert.equal(TABS.teaching.length, 3);
  assert.equal(TABS.family.at(-1)?.labelKey, 'app.tabs.perfil');
  assert.equal(TABS.teaching.at(-1)?.labelKey, 'app.tabs.perfil');
  assert.deepEqual(TABS.maintenance.map((tab) => tab.glyph), ['square', 'triangle', 'diamond']);
});
