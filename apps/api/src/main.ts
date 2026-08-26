import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { assertRlsApplies } from '@poolse/db';
import { AppModule } from './app.module.js';

async function bootstrap(): Promise<void> {
  // Refuse to start if the app is connected as a role that bypasses RLS. A
  // misconfigured DATABASE_APP_URL disables tenant isolation without any visible
  // symptom, so it has to fail here rather than in production six weeks later.
  await assertRlsApplies();

  const app = await NestFactory.create(AppModule);
  app.enableCors({ origin: process.env['WEB_ORIGIN'] ?? 'http://localhost:3000' });

  const port = Number(process.env['API_PORT'] ?? 3001);
  await app.listen(port);
  console.log(`API listening on http://localhost:${port}`);
}

void bootstrap();
