-- Up Migration
--
-- An invitation is good for a day — round 5, ticket 7.
--
-- The window was seven days. The code that issues new ones now says twenty-four
-- hours; this brings the ones already in flight into line, because a rule that
-- applies only to invitations sent after the deploy is a rule with a week-long
-- hole in it.
--
-- **What this does not do is expire everything.** An invitation created two
-- hours ago is not stale, and cutting it short would break somebody who is
-- mid-signup right now for no benefit. So each pending invitation's window is
-- recomputed from when it was *created*: one still inside its first day keeps
-- the rest of that day, and one older than a day becomes expired — which is what
-- the ticket asks for.
--
-- Only pending ones. An accepted invitation's `expires_at` is history, and a
-- revoked one is already refused by `find_invitation_by_token` on a different
-- column; rewriting either would be editing a record of what happened.

UPDATE invitation
   SET expires_at = created_at + interval '24 hours'
 WHERE accepted_at IS NULL
   AND revoked_at IS NULL
   AND expires_at > created_at + interval '24 hours';

COMMENT ON COLUMN invitation.expires_at IS
  'When the token stops working. 24 hours from issue — see INVITATION_TTL_HOURS.';

-- Down Migration
--
-- Puts the seven-day window back on anything still pending, which is the state
-- this migration found. It cannot restore the exact original moment for a row
-- that has since been reissued, and does not pretend to: seven days from
-- creation is what the old code would have written.

UPDATE invitation
   SET expires_at = created_at + interval '7 days'
 WHERE accepted_at IS NULL
   AND revoked_at IS NULL;

COMMENT ON COLUMN invitation.expires_at IS NULL;
