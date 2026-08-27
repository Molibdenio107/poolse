-- An editable staff record — POOLSE-39.
--
-- A staff record could be created and not corrected: a misspelled name, a
-- changed phone number or a promotion all needed a fresh invitation. Two small
-- things are missing from the schema to fix that.
--
-- **Notes.** The club's own note about somebody — "coaches Saturdays", "first
-- aid renewal due". Nothing else on `membership` holds free text.
--
-- **A way to find a pending re-invite.** Moving somebody to a new email is an
-- invitation attached to the membership they already have, rather than to a
-- fresh placeholder. `accept_invitation` then does exactly the right thing
-- without changing: it binds `invitation.membership_id` to the accepting
-- account, so the login moves and the Person, their history, roles and audit
-- trail stay where they are.
--
-- That is the whole mechanism, and it is why this migration is small. The risk
-- the ticket names — "a re-invite that silently orphans the old Person and
-- starts a new one" — is avoided by *not* creating a second membership, not by
-- new machinery to reconcile one.

-- Up Migration

ALTER TABLE membership ADD COLUMN notes text;

ALTER TABLE membership
  ADD CONSTRAINT membership_notes_not_blank
  CHECK (notes IS NULL OR btrim(notes) <> '');

COMMENT ON COLUMN membership.notes IS
  'The club''s note about this person. Not shown to them — POOLSE-39.';

/*
 * Finding the pending re-invite on a record.
 *
 * A re-invite is the only invitation whose membership already holds a login:
 * every other invitation points at a placeholder created moments before. That
 * makes the two distinguishable without a flag column, which is worth avoiding —
 * a flag can disagree with the rows it describes, and this cannot.
 *
 * Partial, because a settled invitation is not pending and there are far more of
 * those than there are open ones.
 */
CREATE INDEX invitation_pending_for_membership_idx
  ON invitation (organization_id, membership_id)
  WHERE accepted_at IS NULL AND revoked_at IS NULL;

-- Down Migration

DROP INDEX IF EXISTS invitation_pending_for_membership_idx;

ALTER TABLE membership DROP CONSTRAINT IF EXISTS membership_notes_not_blank;
ALTER TABLE membership DROP COLUMN IF EXISTS notes;
