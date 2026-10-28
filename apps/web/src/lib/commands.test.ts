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
