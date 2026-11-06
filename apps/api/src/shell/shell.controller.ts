import { Controller, Get, HttpException, Logger } from '@nestjs/common';
import { requireRole } from '../tenant/roles.js';
import { CoreRoute } from '../tenant/modules.js';
import { attentionForReader } from '../attention/attention.controller.js';
import type { Attention } from '../attention/attention.repository.js';
import { logoForReader } from '../files/attachments.controller.js';
import { pendingInboxForReader } from '../meets/meet-inbox.controller.js';
import { subscriptionAlertForReader } from '../billing/subscription.controller.js';
import { supportStatusForReader } from '../support/support.controller.js';

export interface ShellResponse {
  logoFileId: string | null;
  attention: Attention | null;
  meetInboxPending: number | null;
  subscriptionAlert: Awaited<ReturnType<typeof subscriptionAlertForReader>> | null;
  supportStatus: Awaited<ReturnType<typeof supportStatusForReader>> | null;
}

const log = new Logger('Shell');

/**
 * One part of the shell. A refusal is that part being none of this reader's
 * business, which is an ordinary answer; anything else goes to the log, because
 * its words name columns, and costs this part and no other.
 */
export async function part<T>(name: string, read: () => Promise<T>): Promise<T | null> {
  try {
    return await read();
  } catch (error) {
    if (!(error instanceof HttpException)) {
      log.error(`The shell's ${name} failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    return null;
  }
}

/**
 * Everything the `(app)` layout draws beyond `/me`, in one request — POOLSE-172.
 *
 * It was five calls in two rounds on every page change, each paying its own
 * membership resolution. **A tenant route on purpose**: the middleware's
 * suspended and read-only rules and `RequestStatsInterceptor` all apply as they
 * did, and a club that may not read this gets a 403 the web reads as "nothing to
 * draw". `/me` stays beside it, because it has to answer for a suspended club.
 *
 * **Each part keeps its own gate**, in the function its old route calls too, so
 * the two cannot disagree. One after another, not in parallel: every page change
 * passes here, and five pool clients at a time is the costlier way to save a few
 * milliseconds.
 */
@CoreRoute()
@Controller('shell')
export class ShellController {
  @Get()
  async read(): Promise<ShellResponse> {
    requireRole('owner', 'admin', 'instructor', 'maintenance', 'student', 'guardian');
    return {
      logoFileId: await part('logo', logoForReader),
      attention: await part('attention', attentionForReader),
      meetInboxPending: await part('meet inbox', pendingInboxForReader),
      subscriptionAlert: await part('subscription alert', subscriptionAlertForReader),
      supportStatus: await part('support status', supportStatusForReader),
    };
  }
}
