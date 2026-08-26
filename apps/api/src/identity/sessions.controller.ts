import { Controller, ForbiddenException, Get, Logger, Param, Post } from '@nestjs/common';
import { currentAuth } from '../auth/auth.context.js';
import { clerk } from '../auth/clerk.js';

export interface ActiveSession {
  id: string;
  createdAt: string;
  lastActiveAt: string;
  /** The one making this request. Never offered for revocation without warning. */
  isCurrent: boolean;
}

const logger = new Logger('Sessions');

/**
 * The devices an account is signed in on — backlog story 10.
 *
 * **What Clerk actually supports**, checked against the live API rather than
 * assumed, because the story asked for that before anything was designed:
 *
 *   - listing a user's sessions            — yes
 *   - revoking one                         — yes
 *   - a built-in concurrent-device limit   — no such setting exists
 *   - device, browser or IP per session    — not exposed; only timestamps
 *
 * So a cap would have to be enforced by us, and this controller deliberately
 * does not do that. See the note in docs/roadmap.md: automatic revocation is
 * eventually consistent (tokens live ~60s), trivially defeated by signing in
 * again, and would lock the owner out at the worst moments. What it protects
 * against is largely already covered by the single-owner rule from story 9.
 *
 * What is built is the half with real value and no downside: an owner can see
 * that their account is signed in somewhere they do not recognise, and end it.
 *
 * Not role-gated. These are a person's own sessions, and everyone should be able
 * to see where their account is signed in.
 */
@Controller('me/sessions')
export class SessionsController {
  @Get()
  async list(): Promise<{ sessions: ActiveSession[] }> {
    const { clerkUserId, sessionId } = currentAuth();

    const response = await clerk().sessions.getSessionList({
      userId: clerkUserId,
      status: 'active',
    });

    const sessions = response.data
      .map((session) => ({
        id: session.id,
        createdAt: new Date(session.createdAt).toISOString(),
        lastActiveAt: new Date(session.lastActiveAt).toISOString(),
        isCurrent: session.id === sessionId,
      }))
      .sort((a, b) => b.lastActiveAt.localeCompare(a.lastActiveAt));

    return { sessions };
  }

  @Post(':id/revoke')
  async revoke(@Param('id') id: string): Promise<{ revoked: true }> {
    const { clerkUserId } = currentAuth();

    // The check that matters. Without it, any signed-in person could end
    // anybody's session by guessing or harvesting an id — the endpoint would be
    // a remote logout button pointed at the whole instance.
    const session = await clerk().sessions.getSession(id);
    if (session.userId !== clerkUserId) {
      logger.warn(`${clerkUserId} tried to revoke a session belonging to ${session.userId}`);
      // Deliberately the same answer as "no such session": confirming that an id
      // exists but belongs to somebody else is information worth nothing to the
      // caller and something to an attacker.
      throw new ForbiddenException('No such session');
    }

    await clerk().sessions.revokeSession(id);
    return { revoked: true };
  }
}
