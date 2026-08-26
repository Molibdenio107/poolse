-- Up Migration
--
-- Backlog story 9: exactly one owner per organization, enforced by the database.
--
-- The licence is bought by a person, and control of it should stay with that
-- person. Until now `owner` was a role like any other: an owner could invite a
-- second owner, and an admin could too. This makes "there is one owner" a fact
-- about the schema rather than a rule the API remembers — the same move as
-- audit_log giving back its UPDATE grant, and for the same reason. An API check
-- protects against the code paths somebody thought of.
--
-- Ownership is not frozen, it is *transferable*: `transfer_ownership` below moves
-- it in one atomic step. That matters more than it sounds. A single uncreatable
-- owner would mean that the day that person leaves the club or loses their
-- account, nobody can administer the tenant and only the vendor can unblock it.
--
-- **This migration changes existing data.** Any organization that already has
-- more than one owner keeps the earliest — the person who created it — and the
-- others are demoted to `admin` rather than stripped, so nobody is locked out of
-- administration by an upgrade. Each demotion is written to the audit log with a
-- null actor, which is what a null actor is for: the system did this, on nobody's
-- behalf.

-- ---------------------------------------------------------------------------
-- Reconcile the organizations that already have several owners
-- ---------------------------------------------------------------------------

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT mr.id AS role_id, mr.organization_id, mr.membership_id
      FROM membership_role mr
      JOIN membership m ON m.id = mr.membership_id
     WHERE mr.role = 'owner'
       AND mr.archived_at IS NULL
       AND mr.membership_id <> (
         -- The founder: the earliest live owner membership in that organization.
         SELECT m2.id
           FROM membership_role mr2
           JOIN membership m2 ON m2.id = mr2.membership_id
          WHERE mr2.organization_id = mr.organization_id
            AND mr2.role = 'owner'
            AND mr2.archived_at IS NULL
          ORDER BY m2.created_at, m2.id
          LIMIT 1
       )
  LOOP
    UPDATE membership_role SET archived_at = now() WHERE id = r.role_id;

    -- Demoted, not stripped. Losing ownership should not also lose you the
    -- ability to run the place.
    INSERT INTO membership_role (organization_id, membership_id, role)
    SELECT r.organization_id, r.membership_id, 'admin'
     WHERE NOT EXISTS (
       SELECT 1 FROM membership_role
        WHERE membership_id = r.membership_id
          AND role = 'admin'
          AND archived_at IS NULL
     );

    INSERT INTO audit_log (
      organization_id, actor_membership_id, action, entity_type, entity_id, data
    ) VALUES (
      r.organization_id, NULL, 'membership.owner_demoted', 'membership', r.membership_id,
      jsonb_build_object(
        'reason', 'single-owner rule introduced',
        'demoted_to', 'admin'
      )
    );

    RAISE NOTICE 'Demoted a second owner in organization % to admin', r.organization_id;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- One owner, and only one
-- ---------------------------------------------------------------------------

CREATE UNIQUE INDEX membership_role_one_owner
  ON membership_role (organization_id)
  WHERE role = 'owner' AND archived_at IS NULL;

-- ---------------------------------------------------------------------------
-- transfer_ownership
--
-- Ordinary tenant-scoped SQL, deliberately NOT a SECURITY DEFINER function: the
-- caller is already a member of this organization, so `withOrg` reaches
-- everything it needs and no new escape hatch is opened. The list of functions
-- that cross tenants stays exactly as long as it was.
--
-- The order of the two writes is not a style choice. With the unique index above,
-- granting the new owner before revoking the old one violates it — so the old
-- one goes first, inside a transaction where a failure halfway leaves the
-- organization exactly as it was rather than ownerless.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION transfer_ownership(
  p_organization_id uuid,
  p_from_membership uuid,
  p_to_membership   uuid
) RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  IF p_from_membership = p_to_membership THEN
    RAISE EXCEPTION 'Ownership is already held by that membership'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Revoke first, or the unique index refuses the grant.
  UPDATE membership_role
     SET archived_at = now()
   WHERE organization_id = p_organization_id
     AND membership_id = p_from_membership
     AND role = 'owner'
     AND archived_at IS NULL;

  -- The outgoing owner keeps administrative access. Handing the club to a
  -- colleague should not lock you out of it.
  INSERT INTO membership_role (organization_id, membership_id, role)
  SELECT p_organization_id, p_from_membership, 'admin'
   WHERE NOT EXISTS (
     SELECT 1 FROM membership_role
      WHERE membership_id = p_from_membership AND role = 'admin' AND archived_at IS NULL
   );

  INSERT INTO membership_role (organization_id, membership_id, role)
  VALUES (p_organization_id, p_to_membership, 'owner');
END;
$$;

REVOKE ALL ON FUNCTION transfer_ownership(uuid, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION transfer_ownership(uuid, uuid, uuid) TO poolse_app;

-- Down Migration

DROP FUNCTION IF EXISTS transfer_ownership(uuid, uuid, uuid);
DROP INDEX IF EXISTS membership_role_one_owner;
