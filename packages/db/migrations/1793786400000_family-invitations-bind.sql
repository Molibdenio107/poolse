-- Up Migration
--
-- Inviting a family member could not work — found 29-10-2026 while making a
-- student test login (Rui).
--
-- 1. `createInvitation` makes a bare placeholder membership (no name, no
--    address: Clerk owns both once a login binds) and hangs the offered roles on
--    it. `guardian_needs_a_key` then refused a guardian with no NIF and no email
--    at commit, so every invitation offering the guardian role failed. The
--    invitation *is* the address until it is answered, so a pending one now
--    counts as the key.
--
-- 2. `accept_invitation` bound a login to the placeholder as it stood. A
--    placeholder that carried a club-typed name or address (a seed's, or any
--    future path that prepares one) was then refused by
--    `membership_identity_belongs_to_one_owner` — a 500 on *Aceitar*, and the
--    person landed on "create an organization". Binding now clears those three
--    columns, as merging people already does: Clerk owns them from here.

CREATE OR REPLACE FUNCTION guardian_needs_a_key() RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
  v_membership uuid;
  v_has_key    boolean;
  v_is_guardian boolean;
BEGIN
  -- IF, not CASE: PL/pgSQL resolves every branch of a CASE, and NEW has no
  -- membership_id when this fires on `membership`.
  IF TG_TABLE_NAME = 'membership_role' THEN
    v_membership := NEW.membership_id;
  ELSE
    v_membership := NEW.id;
  END IF;

  SELECT EXISTS (
           SELECT 1 FROM membership_role mr
            WHERE mr.membership_id = v_membership
              AND mr.role = 'guardian'
              AND mr.archived_at IS NULL
         )
    INTO v_is_guardian;

  IF NOT v_is_guardian THEN
    RETURN NEW;
  END IF;

  SELECT coalesce(m.tax_number, '') <> ''
         OR coalesce(u.cached_email::text, m.email::text, '') <> ''
         -- An invitation not yet answered carries the address (29-10-2026).
         OR EXISTS (
           SELECT 1 FROM invitation i
            WHERE i.membership_id = m.id
              AND i.accepted_at IS NULL
              AND i.revoked_at IS NULL
         )
    INTO v_has_key
    FROM membership m
    LEFT JOIN app_user u ON u.id = m.app_user_id
   WHERE m.id = v_membership;

  IF NOT coalesce(v_has_key, false) THEN
    RAISE EXCEPTION
      'An encarregado de educação needs a NIF or an email address'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$function$;

-- The bind clears the club-held identity — rewritten in place, refused loudly if
-- the statement it expects has moved. A single-line anchor: a body created from a
-- CRLF migration carries CR LF line ends.
DO $do$
DECLARE def text; rewritten text;
BEGIN
  def := pg_get_functiondef('accept_invitation(text,text,timestamptz)'::regprocedure);
  rewritten := replace(def,
    'SET app_user_id = v_user,',
    'SET app_user_id = v_user, first_name = NULL, last_name = NULL, email = NULL,');
  IF rewritten = def THEN RAISE EXCEPTION 'accept_invitation: the bind was not found'; END IF;
  EXECUTE rewritten;
END
$do$;

-- Down Migration

DO $do$
DECLARE def text; rewritten text;
BEGIN
  def := pg_get_functiondef('accept_invitation(text,text,timestamptz)'::regprocedure);
  rewritten := replace(def,
    'SET app_user_id = v_user, first_name = NULL, last_name = NULL, email = NULL,',
    'SET app_user_id = v_user,');
  IF rewritten = def THEN RAISE EXCEPTION 'accept_invitation: the cleared bind was not found'; END IF;
  EXECUTE rewritten;
END
$do$;

CREATE OR REPLACE FUNCTION guardian_needs_a_key() RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
  v_membership uuid;
  v_has_key    boolean;
  v_is_guardian boolean;
BEGIN
  IF TG_TABLE_NAME = 'membership_role' THEN
    v_membership := NEW.membership_id;
  ELSE
    v_membership := NEW.id;
  END IF;

  SELECT EXISTS (
           SELECT 1 FROM membership_role mr
            WHERE mr.membership_id = v_membership
              AND mr.role = 'guardian'
              AND mr.archived_at IS NULL
         )
    INTO v_is_guardian;

  IF NOT v_is_guardian THEN
    RETURN NEW;
  END IF;

  SELECT coalesce(m.tax_number, '') <> ''
         OR coalesce(u.cached_email::text, m.email::text, '') <> ''
    INTO v_has_key
    FROM membership m
    LEFT JOIN app_user u ON u.id = m.app_user_id
   WHERE m.id = v_membership;

  IF NOT coalesce(v_has_key, false) THEN
    RAISE EXCEPTION
      'An encarregado de educação needs a NIF or an email address'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$function$;
