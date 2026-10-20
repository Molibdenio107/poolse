import { resolve } from 'node:path';

/**
 * Where the phone projects keep the E2E user's signed-in session — POOLSE-88.
 * Written by `auth.setup.ts`, read by `storageState`. Gitignored: it is a live
 * session cookie.
 */
export const PHONE_SESSION = resolve(__dirname, '.auth/phone.json');

export const E2E_EMAIL = process.env['E2E_EMAIL'];
export const E2E_PASSWORD = process.env['E2E_PASSWORD'];

/** Why a signed-in spec skips on a machine with no Clerk test user. */
export const NO_TEST_USER =
  'Set E2E_EMAIL and E2E_PASSWORD to a Clerk test user to run the signed-in specs.';
