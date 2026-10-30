-- Up Migration
--
-- POOLSE-129 — a family is invited from the student's record (Rui, 30-10-2026).
--
-- Until now every invitation made its own placeholder membership, which is right
-- for a new colleague and wrong for a parent the club already has: the guardian
-- exists, with a guardian_link to the child, and a second membership for the
-- same mother is exactly the duplicate the NIF rule exists to prevent. A family
-- invitation now points at the person who already exists — the guardian, or the
-- student's own membership — and accepting binds a login to *that* row.
--
-- 1. `email` may be null, for a family invitation only. A parent with a phone and
--    no address gets the link through the club's own WhatsApp or SMS, and types
--    whatever address they like when they sign up. A staff invitation still
--    needs one, by CHECK, because nothing else would say who it was for.
--
-- 2. One live invitation per person. The existing index on `membership_id` was
--    for lookups; it becomes unique, so a guardian cannot hold two live links
--    (the address index cannot say it once the address may be null).
--
-- 3. Accepting while already a member of the club. The old branch archived the
--    invitation's membership after merging its roles — harmless for a bare
--    placeholder, and a disaster for a guardian: it would archive the record the
--    child's guardian_link hangs off. When the invited membership is a real
--    person (status <> 'invited'), the two are merged with `merge_memberships`,
--    which repoints guardian_link, student.membership_id and every other
--    reference, exactly as Pessoas' merge does.

ALTER TABLE invitation ALTER COLUMN email DROP NOT NULL;

ALTER TABLE invitation
  ADD CONSTRAINT invitation_email_unless_family
  CHECK (email IS NOT NULL OR roles <@ ARRAY['guardian', 'student']::member_role[]);

COMMENT ON COLUMN invitation.email IS
  'Where the link was emailed. Null only for a family invitation shared by hand '
  '(POOLSE-129): the link travelled by the club''s own phone, and the person signs '
  'up with whatever address they choose.';

DROP INDEX invitation_pending_for_membership_idx;
CREATE UNIQUE INDEX invitation_pending_for_membership_uq
  ON invitation (organization_id, membership_id)
  WHERE accepted_at IS NULL AND revoked_at IS NULL;

-- 4. `merge_memberships` copied the absorbed record's name and address onto a
--    survivor that has a login, and `membership_identity_belongs_to_one_owner`
--    (a CHECK, never deferred) refused the statement before the next one could
--    clear them. So merging a no-login duplicate into a person with a login has
--    always failed; Pessoas' merge only ever met two records without one. Where
--    the survivor ends with a login, the name and address are Clerk's and are
--    never copied. Rewritten in place, as above.
DO $do$
DECLARE def text; rewritten text;
BEGIN
  def := replace(pg_get_functiondef('merge_memberships(uuid,uuid,uuid)'::regprocedure), chr(13), '');
  rewritten := replace(replace(replace(def,
    'SET first_name = CASE WHEN k.first_name IS NULL',
    'SET first_name = CASE WHEN coalesce(k.app_user_id, a.app_user_id) IS NOT NULL THEN NULL WHEN k.first_name IS NULL'),
    'last_name  = CASE WHEN k.last_name IS NULL',
    'last_name  = CASE WHEN coalesce(k.app_user_id, a.app_user_id) IS NOT NULL THEN NULL WHEN k.last_name IS NULL'),
    'email      = coalesce(k.email, a.email),',
    'email      = CASE WHEN coalesce(k.app_user_id, a.app_user_id) IS NOT NULL THEN NULL ELSE coalesce(k.email, a.email) END,');
  IF (length(def) - length(rewritten)) > -150 THEN
    RAISE EXCEPTION 'merge_memberships: the name merge was not found';
  END IF;
  /*
   * The same shape bit the NIF and the address: copying the absorbed record's
   * onto the survivor while the absorbed record is still live is a second live
   * holder, refused by `membership_tax_number_uq` / `membership_email_uq`. The
   * absorbed record leaves the partial indexes first; the final UPDATE still
   * stamps `merged_into`.
   */
  def := rewritten;
  rewritten := replace(def, '  UPDATE membership k',
    '  UPDATE membership SET archived_at = now() WHERE id = p_absorb_id;' || chr(10) || chr(10) || '  UPDATE membership k');
  IF rewritten = def THEN RAISE EXCEPTION 'merge_memberships: the field merge was not found'; END IF;
  /*
   * What the club's own login may change, by name. Called from inside
   * `accept_invitation` (a definer function), current_user is the owner, and the
   * loop would have rewritten the insert-only history it exists to leave alone.
   */
  def := rewritten;
  rewritten := replace(def, 'has_column_privilege(current_user,', 'has_column_privilege(''poolse_app'',');
  IF rewritten = def THEN RAISE EXCEPTION 'merge_memberships: the privilege test was not found'; END IF;
  EXECUTE rewritten;
END
$do$;

-- The merge branch — rewritten in place, refused loudly if the statement it
-- expects has moved.
DO $do$
DECLARE def text; rewritten text;
BEGIN
  -- One line ending throughout, so the anchor below matches whichever the
  -- earlier migrations left.
  def := replace(pg_get_functiondef('accept_invitation(text,text,timestamptz)'::regprocedure), chr(13), '');
  rewritten := replace(def,
    'ELSE
    -- Already a member',
    'ELSIF (SELECT status <> ''invited'' AND app_user_id IS NULL FROM membership WHERE id = inv.membership_id) THEN
    -- POOLSE-129: the invitation names a real person the club already had (a
    -- guardian, a student) who has no login of their own. Merge that record into the acceptor''s, so the
    -- child''s guardian_link follows the login instead of being archived.
    PERFORM public.merge_memberships(inv.organization_id, v_existing, inv.membership_id);
    INSERT INTO membership_role (organization_id, membership_id, role)
    SELECT inv.organization_id, v_existing, t.offered
      FROM unnest(inv.roles) AS t(offered)
     WHERE NOT EXISTS (
       SELECT 1 FROM membership_role mr
        WHERE mr.membership_id = v_existing
          AND mr.role = t.offered
          AND mr.archived_at IS NULL
     );
    v_bound := v_existing;
  ELSE
    -- Already a member');
  IF rewritten = def THEN RAISE EXCEPTION 'accept_invitation: the merge branch was not found'; END IF;
  EXECUTE rewritten;
END
$do$;

-- Down Migration

DO $do$
DECLARE def text; head int; tail int;
BEGIN
  def := pg_get_functiondef('accept_invitation(text,text,timestamptz)'::regprocedure);
  head := strpos(def, 'ELSIF (SELECT status');
  tail := strpos(def, '-- Already a member');
  IF head = 0 OR tail = 0 THEN RAISE EXCEPTION 'accept_invitation: the POOLSE-129 branch was not found'; END IF;
  EXECUTE substr(def, 1, head - 1) || 'ELSE' || E'\n    ' || substr(def, tail);
END
$do$;

DO $do$
DECLARE def text;
BEGIN
  def := replace(pg_get_functiondef('merge_memberships(uuid,uuid,uuid)'::regprocedure), chr(13), '');
  def := replace(def, 'CASE WHEN coalesce(k.app_user_id, a.app_user_id) IS NOT NULL THEN NULL WHEN ', 'CASE WHEN ');
  def := replace(def,
    'CASE WHEN coalesce(k.app_user_id, a.app_user_id) IS NOT NULL THEN NULL ELSE coalesce(k.email, a.email) END,',
    'coalesce(k.email, a.email),');
  def := replace(def, '  UPDATE membership SET archived_at = now() WHERE id = p_absorb_id;' || chr(10) || chr(10), '');
  def := replace(def, 'has_column_privilege(''poolse_app'',', 'has_column_privilege(current_user,');
  EXECUTE def;
END
$do$;

DROP INDEX invitation_pending_for_membership_uq;
CREATE INDEX invitation_pending_for_membership_idx
  ON invitation (organization_id, membership_id)
  WHERE accepted_at IS NULL AND revoked_at IS NULL;

ALTER TABLE invitation DROP CONSTRAINT invitation_email_unless_family;
-- Fails if a family invitation without an address exists — on purpose: the down
-- path must not invent an address for somebody.
ALTER TABLE invitation ALTER COLUMN email SET NOT NULL;
