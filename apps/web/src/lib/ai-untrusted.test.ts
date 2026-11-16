import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { SYSTEM } from './timetable-reader-prompt.ts';
import { UNTRUSTED_INPUT } from './ai-untrusted.ts';

// Every file that calls the model must end its instructions with UNTRUSTED_INPUT
// (16-11-2026). A new reader that forgets it fails here, by name.
const root = join(import.meta.dirname, '..');

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.tsx?$/.test(name) && !name.endsWith('.test.ts') ? [path] : [];
  });
}

test('every model call carries the data-not-instructions rule', () => {
  const callers = sources(root).filter((path) => readFileSync(path, 'utf8').includes('new Anthropic('));
  assert.ok(callers.length >= 7, `found only ${callers.length} model callers — has the search broken?`);
  const missing = callers.filter((path) => !readFileSync(path, 'utf8').includes('+ UNTRUSTED_INPUT'));
  // The timetable reader's prompt lives in its own module, checked below.
  const unexplained = missing.filter((path) => !path.endsWith('timetable-reader-agent.ts'));
  assert.deepEqual(unexplained, []);
});

test('the timetable prompt, as the eval sends it, ends with the rule', () => {
  assert.ok(SYSTEM.endsWith(UNTRUSTED_INPUT));
});
