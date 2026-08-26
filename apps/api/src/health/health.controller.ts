import { Controller, Get } from '@nestjs/common';
import { pool } from '@poolse/db';

@Controller('health')
export class HealthController {
  @Get()
  async check(): Promise<{ status: string; database: string }> {
    try {
      await pool.query('SELECT 1');
      return { status: 'ok', database: 'ok' };
    } catch {
      return { status: 'degraded', database: 'unreachable' };
    }
  }
}
