import { BadRequestException, Body, Controller, Get, Post, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { STRICT } from '../common/throttle.js';
import { currentAuth } from '../auth/auth.context.js';
import { ensureAppUser } from '../identity/identity.service.js';
import {
  acceptInvitation,
  findInvitationByTokenHash,
  type AcceptResult,
  type InvitationPreview,
} from './invitations.repository.js';
import { hashToken } from './invitations.service.js';

interface AcceptBody {
  token?: unknown;
}

/**
 * Redeeming an invitation, from outside any tenant.
 *
 * The preview is public (29-10-2026): what is being offered is shown before the
 * person has an account, the way every invitation flow people already know does
 * it, and the sign-in wall sits on the accept button instead. Accepting stays
 * authenticated — you must have an account before you can be a member of
 * anything — but excluded from TenantMiddleware, because the whole point is that
 * the caller has no membership in this organization yet. It is the third and last
 * route in that position, alongside `/me` and `POST /organizations`.
 *
 * Given its own path rather than living under `/invitations` so the exclusion
 * list in AppModule stays a list of whole paths. A prefix that is tenant-scoped
 * except for two routes underneath it is the kind of arrangement that eventually
 * gets one of them wrong.
 */
@Controller('join')
export class JoinController {
  /**
   * What the acceptance screen shows before the person commits. Every failure
   * mode comes back as a status, not an error: "this link expired" is an ordinary
   * thing to be told, and it needs to be told in the reader's language.
   *
   * No session: `join/preview` is in `PUBLIC_ROUTES`. The token is the only key,
   * hashed before it reaches the database, and the bucket is per token.
   */
  @Throttle(STRICT)
  @Get('preview')
  async preview(@Query('token') token?: string): Promise<InvitationPreview> {
    if (!token) throw new BadRequestException('A token is required');
    return findInvitationByTokenHash(hashToken(token));
  }

  @Throttle(STRICT)
  @Post()
  async accept(@Body() body: AcceptBody): Promise<AcceptResult> {
    const token = typeof body.token === 'string' ? body.token.trim() : '';
    if (!token) throw new BadRequestException('A token is required');

    const { clerkUserId } = currentAuth();

    // Someone who signed up in order to accept an invitation is the most likely
    // caller here, so this is precisely where the webhook is most likely not to
    // have landed yet. Provision first, then bind.
    await ensureAppUser(clerkUserId);

    return acceptInvitation(hashToken(token), clerkUserId);
  }
}
