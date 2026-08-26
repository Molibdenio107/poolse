import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import type { Response } from 'express';
import { pool } from '@poolse/db';

interface Health {
  status: 'ok' | 'degraded';
  database: 'ok' | 'unreachable';
}

/**
 * The platform's health check, and the one the deploy pipeline gates on.
 *
 * Returns 503 when the database is unreachable, rather than 200 with a sad
 * message in the body. Railway and every other host read the status code and
 * nothing else, so a health endpoint that always answers 200 is a health check
 * that always passes — it would wave through a deploy whose database credentials
 * are wrong and take the site down instead of rolling back.
 *
 * Public, so it carries no detail worth having: which of the two things is
 * broken, and nothing about why.
 */
@Controller('health')
export class HealthController {
  @Get()
  async check(@Res({ passthrough: true }) res: Response): Promise<Health> {
    try {
      await pool.query('SELECT 1');
      return { status: 'ok', database: 'ok' };
    } catch {
      res.status(HttpStatus.SERVICE_UNAVAILABLE);
      return { status: 'degraded', database: 'unreachable' };
    }
  }
}
