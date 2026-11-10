-- Up Migration

/*
 * POOLSE-210 (Rui, 10-11-2026): the club's phone, as POOLSE-209 gave it an email.
 *
 * `contact_phone` is a number the club publishes for families to call or message
 * on WhatsApp. Poolse never sends from it: there is no SMS or WhatsApp provider,
 * and a per-message cost breaks the free pilot. Stored international, `+` and
 * 8 to 15 digits (`+351912345678`); null means the club publishes none, and the
 * screens then say nothing rather than a placeholder. Optional and clearable:
 * unlike the reply email there is no fallback, because an owner's own mobile is
 * not the club's to publish.
 *
 * Shown on the family app, in the footer of club emails and on the two public
 * pages. Both public definer functions gain one key **in place**
 * (`pg_get_functiondef` + `replace`), never restated from a file: the water
 * page's module filter was itself added in place by 1791799200000, and a
 * restatement from the last file that held the whole body silently dropped it
 * (caught by the modules test, 10-11-2026). Refused loudly if the text moved.
 */

ALTER TABLE organization
  ADD COLUMN contact_phone text,
  ADD CONSTRAINT organization_contact_phone_format
    CHECK (contact_phone IS NULL OR contact_phone ~ '^\+[0-9]{8,15}$');

GRANT UPDATE (contact_phone) ON organization TO poolse_app;

DO $do$
DECLARE
  def text;
  rewritten text;
BEGIN
  def := pg_get_functiondef('public_water_page(text)'::regprocedure);
  rewritten := replace(
    def,
    '''complaintsUrl'', o.complaints_url,',
    '''complaintsUrl'', o.complaints_url,' || chr(10) ||
    '           ''contactPhone'', o.contact_phone,'
  );
  IF rewritten = def THEN
    RAISE EXCEPTION 'public_water_page: the complaints key was not found';
  END IF;
  EXECUTE rewritten;

  def := pg_get_functiondef('public_lead_form(text)'::regprocedure);
  rewritten := replace(
    def,
    '''complaintsUrl'', v_url,',
    '''complaintsUrl'', v_url,' || chr(10) ||
    '    ''contactPhone'', (SELECT o.contact_phone FROM organization o WHERE o.id = v_org),'
  );
  IF rewritten = def THEN
    RAISE EXCEPTION 'public_lead_form: the complaints key was not found';
  END IF;
  EXECUTE rewritten;
END
$do$;

-- Down Migration

DO $do$
DECLARE
  def text;
  rewritten text;
BEGIN
  def := pg_get_functiondef('public_water_page(text)'::regprocedure);
  rewritten := replace(def, chr(10) || '           ''contactPhone'', o.contact_phone,', '');
  IF rewritten = def THEN
    RAISE EXCEPTION 'public_water_page: the phone key was not found';
  END IF;
  EXECUTE rewritten;

  def := pg_get_functiondef('public_lead_form(text)'::regprocedure);
  rewritten := replace(
    def,
    chr(10) || '    ''contactPhone'', (SELECT o.contact_phone FROM organization o WHERE o.id = v_org),',
    ''
  );
  IF rewritten = def THEN
    RAISE EXCEPTION 'public_lead_form: the phone key was not found';
  END IF;
  EXECUTE rewritten;
END
$do$;

REVOKE UPDATE (contact_phone) ON organization FROM poolse_app;

ALTER TABLE organization
  DROP CONSTRAINT IF EXISTS organization_contact_phone_format,
  DROP COLUMN IF EXISTS contact_phone;
