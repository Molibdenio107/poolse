-- The Owner acknowledges that support ended its session — Rui, 11-11-2026.
--
-- When support ends a window itself, the club's strip says so. It used to go
-- after 24 hours; now it stays until an Owner presses *Tomei conhecimento* on
-- *Acesso de suporte*, having seen what support did (and still lapses after 7
-- days, like an unanswered request, so a club nobody opens is not nagged for
-- ever). Who acknowledged and when are recorded on the grant itself.
--
-- Only a window support ended can be acknowledged — a revoked or expired one
-- was the club's own doing or nobody's, and there is nothing to be told.

-- Up Migration

ALTER TABLE support_grant
  ADD COLUMN acknowledged_at timestamptz,
  ADD COLUMN acknowledged_by_membership_id uuid,
  ADD CONSTRAINT support_grant_acknowledged_by_fkey
    FOREIGN KEY (organization_id, acknowledged_by_membership_id) REFERENCES membership (organization_id, id),
  ADD CONSTRAINT support_grant_acknowledged_says_who CHECK (
    (acknowledged_at IS NULL) = (acknowledged_by_membership_id IS NULL)
  ),
  ADD CONSTRAINT support_grant_acknowledged_after_support CHECK (
    acknowledged_at IS NULL OR ended_by = 'support'
  );

COMMENT ON COLUMN support_grant.acknowledged_at IS
  'An Owner saw that support ended this window (11-11-2026): the club''s strip stops saying so.';

-- The club writes the acknowledgement and nothing more of the grant.
GRANT UPDATE (acknowledged_at, acknowledged_by_membership_id) ON support_grant TO poolse_app;

-- Down Migration

REVOKE UPDATE (acknowledged_at, acknowledged_by_membership_id) ON support_grant FROM poolse_app;
ALTER TABLE support_grant
  DROP CONSTRAINT support_grant_acknowledged_after_support,
  DROP CONSTRAINT support_grant_acknowledged_says_who,
  DROP CONSTRAINT support_grant_acknowledged_by_fkey,
  DROP COLUMN acknowledged_by_membership_id,
  DROP COLUMN acknowledged_at;
