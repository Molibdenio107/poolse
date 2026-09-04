import './load-env.js';
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { assertRlsApplies } from '@poolse/db';
import { AppModule } from './app.module.js';
import { BadInputFilter } from './tenant/bad-input.filter.js';

/**
 * Secrets the app cannot start without. Checked together so a fresh clone with a
 * half-filled .env reports everything missing at once rather than one per restart.
 */
const REQUIRED_ENV = [
  'DATABASE_APP_URL',
  'CLERK_SECRET_KEY',
  'CLERK_WEBHOOK_SIGNING_SECRET',
  // Medical notes are encrypted with this before they reach the database. Not
  // optional: a missing key must stop the app, never quietly become a code path
  // that stores special-category data in the clear.
  'SENSITIVE_DATA_KEY',
];

async function bootstrap(): Promise<void> {
  const missing = REQUIRED_ENV.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }

  // Refuse to start if the app is connected as a role that bypasses RLS. A
  // misconfigured DATABASE_APP_URL disables tenant isolation without any visible
  // symptom, so it has to fail here rather than in production six weeks later.
  await assertRlsApplies();

  // rawBody keeps the exact bytes of the request alongside the parsed body. The
  // Clerk webhook signature is computed over those bytes, and a re-serialised
  // body does not match.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { rawBody: true });
  app.enableCors({ origin: process.env['WEB_ORIGIN'] ?? 'http://localhost:3000' });

  // A truncated link in an email is a 404, not a 500 — POOLSE-R3-01.
  app.useGlobalFilters(new BadInputFilter());

  // PORT is what every platform-as-a-service injects; API_PORT is what this repo
  // calls it locally. Reading both means neither the Dockerfile nor the host has
  // to translate, and a missing PORT in production falls back to something that
  // at least starts rather than crashing on NaN.
  const port = Number(process.env['PORT'] ?? process.env['API_PORT'] ?? 3001);
  await app.listen(port);
  console.log(`API listening on http://localhost:${port}`);
}

void bootstrap();
