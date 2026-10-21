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

/**
 * A second test user who is only an instructor in the E2E user's club —
 * POOLSE-88 slice 2, because the poolside flows are an instructor's and a
 * register an owner can take proves nothing about one an instructor can.
 */
export const INSTRUCTOR_SESSION = resolve(__dirname, '.auth/instructor.json');

export const E2E_INSTRUCTOR_EMAIL = process.env['E2E_INSTRUCTOR_EMAIL'];
export const E2E_INSTRUCTOR_PASSWORD = process.env['E2E_INSTRUCTOR_PASSWORD'];

export const NO_INSTRUCTOR =
  'Set E2E_INSTRUCTOR_EMAIL and E2E_INSTRUCTOR_PASSWORD to run the instructor half of the poolside specs.';
