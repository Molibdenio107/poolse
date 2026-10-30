-- Up Migration
--
-- A staff invitation by email or phone, to the person the club already has —
-- Rui, 30-10-2026: "the email or phone number should work as an identifier",
-- for staff as for students.
--
-- 1. Any invitation may be a link with no address. A staff member reached by
--    phone gets the link through the club's own WhatsApp or SMS, as a family
--    does since POOLSE-129; the CHECK that kept staff invitations addressed goes.
--
-- 2. Accepting adds the offered roles to the record the invitation names. An
--    invitation used to make its own placeholder carrying the roles, so binding
--    needed none. Now a staff invitation may name somebody the club already
--    has (a guardian who will teach), and the roles must arrive with the login,
--    not before it — a role on a record nobody can sign in to would put them on
--    Pessoas as staff who never answered. For a placeholder the insert finds the
--    roles already there and adds nothing.

ALTER TABLE invitation DROP CONSTRAINT invitation_email_unless_family;

COMMENT ON COLUMN invitation.email IS
  'Where the link was emailed. Null for a link shared by hand from the club''s '
  'phone (POOLSE-129): the person signs up with whatever address they choose.';

DO $do$
DECLARE def text; rewritten text;
BEGIN
  def := replace(pg_get_functiondef('accept_invitation(text,text,timestamptz)'::regprocedure), chr(13), '');
  rewritten := replace(def,
    '    v_bound := inv.membership_id;
  ELSIF',
    '    -- The offered roles arrive with the login (30-10-2026): an invitation may
    -- name a record the club already had, which holds none of them yet.
    INSERT INTO membership_role (organization_id, membership_id, role)
    SELECT inv.organization_id, inv.membership_id, t.offered
      FROM unnest(inv.roles) AS t(offered)
     WHERE NOT EXISTS (
       SELECT 1 FROM membership_role mr
        WHERE mr.membership_id = inv.membership_id
          AND mr.role = t.offered
          AND mr.archived_at IS NULL
     );

    v_bound := inv.membership_id;
  ELSIF');
  IF rewritten = def THEN RAISE EXCEPTION 'accept_invitation: the bind branch was not found'; END IF;
  EXECUTE rewritten;
END
$do$;

-- Down Migration

DO $do$
DECLARE def text; head int; tail int;
BEGIN
  def := replace(pg_get_functiondef('accept_invitation(text,text,timestamptz)'::regprocedure), chr(13), '');
  head := strpos(def, '    -- The offered roles arrive with the login (30-10-2026)');
  tail := strpos(def, '    v_bound := inv.membership_id;
  ELSIF');
  IF head = 0 OR tail = 0 THEN RAISE EXCEPTION 'accept_invitation: the role insert was not found'; END IF;
  EXECUTE substr(def, 1, head - 1) || substr(def, tail);
END
$do$;

ALTER TABLE invitation
  ADD CONSTRAINT invitation_email_unless_family
  CHECK (email IS NOT NULL OR roles <@ ARRAY['guardian', 'student']::member_role[]);
