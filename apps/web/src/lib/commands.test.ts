import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { POOLSE_MODULES } from '@poolse/rules';
import { commandsFor, score, type Command } from './commands.ts';

/**
 * The command palette — POOLSE-118. It offers what the sidebar offers, through
 * the sidebar's own filter, and matches the words people type in their own
 * language. Labels are read from the real catalogues.
 */

const catalogue = (locale: string): Record<string, unknown> =>
  JSON.parse(readFileSync(new URL(`../messages/${locale}.json`, import.meta.url), 'utf8'));

function translate(locale: string): (key: string) => string {
  const messages = catalogue(locale);
  return (key) => {
    const value = key.split('.').reduce<unknown>((at, part) => (at as Record<string, unknown>)?.[part], messages);
    return typeof value === 'string' ? value : key;
  };
}

function search(commands: Command[], query: string, locale: string): string[] {
  const t = translate(locale);
  return commands
    .map((command) => ({ command, fit: score(command, t(command.labelKey), query, locale) }))
    .filter((one) => one.fit !== null)
    .sort((a, b) => (b.fit ?? 0) - (a.fit ?? 0))
    .map((one) => one.command.id);
}

const everyModule = [...POOLSE_MODULES];

test('QA 1: an owner typing "quot" lands on Em dívida first', () => {
  const owner = commandsFor({ roles: ['owner'], kind: 'business', modules: everyModule });
  assert.equal(search(owner, 'quot', 'pt-PT')[0], 'owing');
  assert.equal(search(owner, 'presenç', 'pt-PT').includes('register'), false, 'the register action is an instructor’s');
});

test('QA 2: maintenance is offered no student page, and a module that is off takes its page with it', () => {
  const maintenance = commandsFor({ roles: ['maintenance'], kind: 'business', modules: everyModule });
  assert.ok(maintenance.every((command) => !('href' in command.run) || !command.run.href.startsWith('/dashboard/students')));
  assert.ok(maintenance.some((command) => command.id === 'page:/dashboard/facilities/incidents'));

  const noIncidents = commandsFor({
    roles: ['owner'],
    kind: 'business',
    modules: everyModule.filter((module) => module !== 'incidents'),
  });
  assert.ok(noIncidents.every((command) => command.id !== 'page:/dashboard/facilities/incidents'));
  const noInvoicing = commandsFor({
    roles: ['owner'],
    kind: 'business',
    modules: everyModule.filter((module) => module !== 'invoicing'),
  });
  assert.ok(noInvoicing.every((command) => command.id !== 'owing'));
});

test('QA 3: in English "overdue" matches Em dívida and "quotas" does not', () => {
  const owner = commandsFor({ roles: ['owner'], kind: 'business', modules: everyModule });
  assert.equal(search(owner, 'overdue', 'en')[0], 'owing');
  assert.equal(search(owner, 'quotas', 'en').includes('owing'), false);
});

test('accents and case do not matter, and every page appears once', () => {
  const owner = commandsFor({ roles: ['owner'], kind: 'business', modules: everyModule });
  assert.equal(search(owner, 'FERIAS', 'pt-PT')[0], 'page:/dashboard/facilities/staff/vacations');
  const ids = owner.map((command) => command.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('POOLSE-167: the palette lists Mínimos under Natação', () => {
  const commands = commandsFor({ roles: ['owner'], kind: 'business', modules: [...POOLSE_MODULES], sports: ['pool'] });
  const minimos = commands.find((command) => command.labelKey === 'qualifying.section.minimos');
  assert.equal(minimos?.sportKey, 'sport.name.pool');
  assert.deepEqual(minimos?.run, { href: '/dashboard/students/provas/minimos?sport=pool' });
});

test('a tab of the site is one word away: *documents* goes straight there (Rui, 07-11-2026)', () => {
  const owner = commandsFor({ roles: ['owner'], kind: 'business', modules: [...POOLSE_MODULES] });
  const documents = owner.find((one) => one.id === 'siteDocuments')!;
  assert.deepEqual(documents.run, { href: '/dashboard/facilities/site?tab=documents' });
  for (const query of ['documentos', 'documents', 'boletim']) {
    assert.ok((score(documents, 'Documentos', query, 'pt-PT') ?? 0) > 0, query);
  }
  assert.ok((score(documents, 'Documents', 'forms', 'en') ?? 0) > 0);
});

test('only the Owner is offered the subscription, the support access and the app views', () => {
  const ids = (roles: string[]): string[] =>
    commandsFor({ roles, kind: 'business', modules: [...POOLSE_MODULES] }).map((one) => one.id);
  for (const id of ['subscription', 'supportAccess', 'appViews']) {
    assert.ok(ids(['owner']).includes(id), id);
    assert.equal(ids(['admin']).includes(id), false, id);
  }
  assert.ok(ids(['admin']).includes('siteDocuments'));
  assert.equal(ids(['instructor']).includes('siteDocuments'), false);
  assert.equal(ids(['guardian']).includes('archive'), false);
});

test('the phone app has its own search, and each role sees only its own screens', () => {
  const ids = (roles: string[], place = {}): string[] =>
    commandsFor({ roles, kind: 'business', modules: [...POOLSE_MODULES] }, { surface: 'app', ...place }).map(
      (one) => one.id,
    );
  const family = ids(['guardian']);
  assert.ok(family.includes('appDocuments'));
  assert.equal(family.includes('appTeaching'), false);
  assert.equal(family.includes('newStudent'), false);
  assert.equal(family.some((id) => id.startsWith('page:')), false, 'no backoffice page for a family');

  const coach = ids(['instructor']);
  assert.ok(coach.includes('appTeaching'));
  assert.equal(coach.includes('appDocuments'), false);

  // Owner and teacher on the phone: their own classes, and the club.
  const owner = ids(['owner', 'instructor']);
  assert.ok(owner.includes('appTeaching'));
  assert.ok(owner.includes('siteDocuments'));

  // Under a view, only the person's app, whoever is looking.
  const viewed = ids(['guardian'], { viewing: true });
  assert.ok(viewed.includes('appFees'));
  assert.equal(viewed.some((id) => id.startsWith('page:') || id.startsWith('site')), false);
});

test('the backoffice bar does not offer the phone app’s screens', () => {
  const ids = commandsFor({ roles: ['owner'], kind: 'business', modules: [...POOLSE_MODULES] }).map((one) => one.id);
  assert.equal(ids.some((id) => id.startsWith('app') && id !== 'appViews'), false);
});
