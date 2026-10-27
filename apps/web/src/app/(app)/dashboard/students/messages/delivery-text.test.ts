import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { audienceKey } from './delivery-text.ts';

/**
 * Every audience the API can store has a label in both languages — sweep,
 * 13-10-2026. `messages.to.closure` was missing, so every message sent about a
 * closure listed as its raw key; `check-messages` proves a computed prefix
 * exists, never each leaf.
 */
const AUDIENCES = ['class_group', 'level', 'facility', 'organization', 'closure', 'session'] as const;

for (const locale of ['pt-PT', 'en']) {
  test(`every message audience is translated (${locale})`, () => {
    const catalogue = JSON.parse(
      readFileSync(new URL(`../../../../../messages/${locale}.json`, import.meta.url), 'utf-8'),
    ) as Record<string, unknown>;
    for (const audience of AUDIENCES) {
      const value = audienceKey(audience)
        .split('.')
        .reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], catalogue);
      assert.equal(typeof value, 'string', `${locale}: ${audienceKey(audience)} is missing`);
    }
  });
}
