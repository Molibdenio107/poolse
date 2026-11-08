import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TABS, appHome, familyOnly, hatsOf, homeChoice, landsInTeaching, phoneBrowser, rememberedHome, tabFor } from './app-hats.ts';

/**
 * Who lands where in app mode — POOLSE-90, QA 1 and 2. The router, the switcher
 * and the dashboard's redirect all read this, so it is pinned once here.
 */

test('an owner or admin is sent to the backoffice, whatever else they are', () => {
  assert.equal(appHome(['owner']), '/dashboard');
  assert.equal(appHome(['admin', 'guardian']), '/dashboard');
});

test('POOLSE-188: a device remembers the way in, for one person, while they hold it', () => {
  assert.equal(rememberedHome(undefined, 'me', ['teaching']), null);
  assert.equal(rememberedHome(homeChoice('me', null), 'me', ['teaching']), 'backoffice');
  assert.equal(rememberedHome(homeChoice('me', 'teaching'), 'me', ['teaching']), 'teaching');
  assert.equal(rememberedHome(homeChoice('me', 'teaching'), 'me', []), null, 'a home no longer held');
  assert.equal(rememberedHome(homeChoice('other', 'teaching'), 'me', ['teaching']), null, 'somebody else');
  assert.equal(rememberedHome('me:owner', 'me', ['teaching']), null, 'a forged cookie opens nothing');
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

test('the server tells a phone from a computer or a tablet', () => {
  const iphone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
  const android = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36';
  const tablet = 'Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
  const desktop = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
  assert.equal(phoneBrowser(iphone, null), true);
  assert.equal(phoneBrowser(android, '?1'), true);
  assert.equal(phoneBrowser(desktop, '?1'), true);
  assert.equal(phoneBrowser(tablet, '?0'), false);
  assert.equal(phoneBrowser(desktop, '?0'), false);
  assert.equal(phoneBrowser(null, null), false);
});

test('a teacher who does not run the club arrives in their app on a phone', () => {
  assert.equal(landsInTeaching(['instructor']), true);
  assert.equal(landsInTeaching(['instructor', 'guardian']), true);
  assert.equal(landsInTeaching(['owner', 'instructor']), false);
  assert.equal(landsInTeaching(['admin', 'instructor']), false);
  assert.equal(landsInTeaching(['maintenance']), false);
  assert.equal(landsInTeaching(['guardian']), false);
});

test('a family and nothing else is family-only', () => {
  assert.equal(familyOnly(['guardian']), true);
  assert.equal(familyOnly(['guardian', 'student']), true);
  assert.equal(familyOnly([]), false);
});


// POOLSE-136 — which bar a screen wears, and which tab is current.
const q = (query = '') => new URLSearchParams(query);

test("a home's own tabs carry the bar; and so does a screen deeper in", () => {
  assert.deepEqual(tabFor('/app/familia', q(), ['family', 'teaching']), { hat: 'family', index: 0 });
  assert.deepEqual(tabFor('/app/familia/aulas', q('child=x'), ['family', 'teaching']), { hat: 'family', index: 1 });
  assert.deepEqual(tabFor('/app/familia/progressos', q(), ['family', 'teaching']), { hat: 'family', index: 2 });
  // A screen deeper in keeps the bar, lit on the tab that leads to it (Rui, 06-11-2026).
  assert.deepEqual(tabFor('/app/familia/pagamentos', q(), ['family', 'teaching']), { hat: 'family', index: 3 });
  assert.deepEqual(tabFor('/app/familia/documentos/abc/fpn/rever', q(), ['family']), { hat: 'family', index: 3 });
  assert.deepEqual(tabFor('/app/familia/aulas/abc', q(), ['family', 'teaching']), { hat: 'family', index: 1 });
  assert.deepEqual(tabFor('/app/familia/inscrever', q(), ['family', 'teaching']), { hat: 'family', index: 1 });
  assert.deepEqual(tabFor('/app/manutencao/reportar', q(), ['maintenance']), { hat: 'maintenance', index: 1 });
  assert.deepEqual(tabFor('/app/perfil/definicoes', q('home=family'), ['teaching', 'family']), { hat: 'family', index: 3 });
  assert.equal(tabFor('/app', q(), ['family']), null);
});

test('Hoje and Semana are one page; Perfil wears the home it was opened from', () => {
  assert.deepEqual(tabFor('/app/aulas', q(), ['teaching']), { hat: 'teaching', index: 0 });
  assert.deepEqual(tabFor('/app/aulas/calendario', q(), ['teaching']), { hat: 'teaching', index: 1 });
  assert.deepEqual(tabFor('/app/aulas/abc', q(), ['teaching']), { hat: 'teaching', index: 1 });
  assert.deepEqual(tabFor('/app/perfil', q('home=family'), ['teaching', 'family']), { hat: 'family', index: 3 });
  assert.deepEqual(tabFor('/app/perfil', q(), ['teaching', 'family']), { hat: 'teaching', index: 3 });
  // Alunos (Rui, 07-11-2026): the list and a student's card.
  assert.deepEqual(tabFor('/app/alunos', q(), ['teaching']), { hat: 'teaching', index: 2 });
  assert.deepEqual(tabFor('/app/alunos/abc', q(), ['teaching']), { hat: 'teaching', index: 2 });
  // POOLSE-181: maintenance has its own bar, and Perfil wears it.
  assert.deepEqual(tabFor('/app/perfil', q(), ['maintenance']), { hat: 'maintenance', index: 2 });
  assert.deepEqual(tabFor('/app/perfil', q('home=maintenance'), ['teaching', 'maintenance']), { hat: 'maintenance', index: 2 });
  assert.deepEqual(tabFor('/app/manutencao', q(), ['maintenance']), { hat: 'maintenance', index: 0 });
  assert.deepEqual(tabFor('/app/manutencao/registar', q(), ['maintenance']), { hat: 'maintenance', index: 1 });
  // A home the reader does not have is ignored, never drawn.
  assert.deepEqual(tabFor('/app/perfil', q('home=family'), ['teaching']), { hat: 'teaching', index: 3 });
});

test('the family and the instructor have four tabs each, Perfil last (Rui, 31-10 and 07-11-2026)', () => {
  assert.equal(TABS.family.length, 4);
  assert.equal(TABS.teaching.length, 4);
  assert.equal(TABS.family.at(-1)?.labelKey, 'app.tabs.perfil');
  assert.equal(TABS.teaching.at(-1)?.labelKey, 'app.tabs.perfil');
  assert.deepEqual(TABS.maintenance.map((tab) => tab.glyph), ['square', 'triangle', 'diamond']);
});
