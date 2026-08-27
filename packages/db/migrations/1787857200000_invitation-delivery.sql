-- Up Migration
--
-- Whether an invitation was actually delivered — backlog round 4, ticket 5.
--
-- The ticket's diagnosis was that nothing sends the email. It does: the API
-- composes the message, calls `sendEmail`, and hands the result back to the
-- client as `emailed`. Nothing arrives because `EMAIL_PROVIDER` is `console`,
-- which logs instead of sending — the "check the obvious first" the ticket ends
-- on.
--
-- What was genuinely missing is the acceptance criterion "a failed send is
-- visible in the interface — the invitation shows as failed, not as sent".
-- `emailed` lived only in the response to the request that created it. Close the
-- tab and the pending list could not tell you whether anybody had been written
-- to, which is exactly the state an operator is in when they wonder why their
-- instructor has not joined.
--
-- Three states, not two. `pending` matters: it is what a row says between being
-- created and delivery being attempted, and it is the honest answer when the
-- process died in between.

CREATE TYPE invitation_delivery AS ENUM ('pending', 'sent', 'failed', 'not_configured');

ALTER TABLE invitation
  ADD COLUMN delivery       invitation_delivery NOT NULL DEFAULT 'pending',
  ADD COLUMN delivered_at   timestamptz;

COMMENT ON COLUMN invitation.delivery IS
  'pending | sent | failed | not_configured. not_configured is not a failure: '
  'no provider is set up, so the link is meant to be copied by hand.';

-- Existing rows predate delivery tracking, and claiming they were sent would be
-- worse than admitting we do not know. `not_configured` is the truthful answer:
-- every invitation issued before this migration was issued with EMAIL_PROVIDER
-- unset.
UPDATE invitation SET delivery = 'not_configured' WHERE delivery = 'pending';

-- Down Migration

ALTER TABLE invitation
  DROP COLUMN IF EXISTS delivered_at,
  DROP COLUMN IF EXISTS delivery;

DROP TYPE IF EXISTS invitation_delivery;
