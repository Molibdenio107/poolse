-- Names read first name + surname — POOLSE-32.
--
-- Test 2 is the one to keep. The ticket names the likely mistake precisely:
-- assuming the last whitespace token is the surname. That assumption abbreviates
-- "Maria da Silva" to "Maria da", which is not a name, and it fails silently on
-- a roster somebody has already printed. Every row in that test is a shape that
-- breaks the naive rule.
--
-- Test 4 is the other. It asserts that display abbreviation and filing use
-- *different* surnames on purpose — last for the short name, first for the sort
-- key — because the temptation to "simplify" them into one is exactly how one of
-- the two ends up wrong.
--
-- Run: pnpm db:test

\set ON_ERROR_STOP on
BEGIN;

INSERT INTO organization (name, slug) VALUES ('Clube Nomes', 'clube-nomes');

-- ---------------------------------------------------------------------------
-- Test 1: the two forms of one name — criteria 1, 2 and 3
--
-- The full legal name keeps every part, for the detail page and for documents.
-- The short form keeps two, for a turma card that has room for two.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_full text; v_short text;
BEGIN
  v_full  := display_name('Maria Joana', 'Ferreira Silva Santos');
  v_short := short_name('Maria Joana', 'Ferreira Silva Santos');

  IF v_full <> 'Maria Joana Ferreira Silva Santos' THEN
    RAISE EXCEPTION 'FAIL test 1: display_name returned %', v_full;
  END IF;

  IF v_short <> 'Maria Santos' THEN
    RAISE EXCEPTION 'FAIL test 1: short_name returned %', v_short;
  END IF;

  -- "Silva, Maria" is what this ticket exists to remove. Neither form may ever
  -- contain a comma, whatever the parts were.
  IF v_full LIKE '%,%' OR v_short LIKE '%,%' THEN
    RAISE EXCEPTION 'FAIL test 1: a name came back in filing-cabinet form';
  END IF;

  RAISE NOTICE 'PASS test 1: the full name keeps every part, the short name keeps two';
END $$;

-- ---------------------------------------------------------------------------
-- Test 2: the shapes that break "the last token is the surname"
--
-- Every row here returns something wrong under the naive rule, and the wrongness
-- is silent. QA 32.6 and 32.13.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      -- given,         surnames,                expected short
      ('Maria',         'da Silva',              'Maria da Silva'),   -- never "Maria da"
      ('João',          'dos Santos Costa',      'João Costa'),       -- particle mid-name
      ('Pedro',         'de Sousa e Melo',       'Pedro de Sousa e Melo'), -- "e" joins one surname
      ('Ana',           'Costa-Ribeiro',         'Ana Costa-Ribeiro'), -- a hyphen is not a space
      ('Maria Joana',   'Ferreira Silva Santos', 'Maria Santos'),      -- the ordinary long name
      ('Rita',          'Silva de',              'Rita Silva de'),     -- a trailing particle is not dropped
      ('Sofia',         'Marques',               'Sofia Marques')      -- already the short form
    ) v(given, surnames, expected)
  LOOP
    IF short_name(r.given, r.surnames) <> r.expected THEN
      RAISE EXCEPTION 'FAIL test 2: "% / %" abbreviated to "%" rather than "%"',
        r.given, r.surnames, short_name(r.given, r.surnames), r.expected;
    END IF;
  END LOOP;

  RAISE NOTICE 'PASS test 2: particles, joiners and hyphens survive abbreviation';
END $$;

-- ---------------------------------------------------------------------------
-- Test 3: a single-part name — QA 32.5
--
-- "Madonna" has no surname. All three functions must answer, none may pad the
-- result with a stray space, and she must still file under M rather than under
-- nothing — a person who sorts to the top of every list because their key is
-- empty is a bug somebody notices late.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_org uuid; v_id uuid;
BEGIN
  IF short_name('Madonna', NULL) <> 'Madonna' THEN
    RAISE EXCEPTION 'FAIL test 3: short_name of a single-part name is %',
      short_name('Madonna', NULL);
  END IF;

  IF display_name('Madonna', '') <> 'Madonna' THEN
    RAISE EXCEPTION 'FAIL test 3: display_name of a single-part name is "%"',
      display_name('Madonna', '');
  END IF;

  IF left(name_sort_key('Madonna', NULL), 1) <> 'M' THEN
    RAISE EXCEPTION 'FAIL test 3: a single-part name files under "%"',
      left(name_sort_key('Madonna', NULL), 1);
  END IF;

  -- Nobody at all is null rather than a space, so a caller can coalesce it.
  IF display_name(NULL, NULL) IS NOT NULL OR short_name('  ', '  ') IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL test 3: an empty name came back as whitespace';
  END IF;

  RAISE NOTICE 'PASS test 3: a single-part name displays, abbreviates and files';
END $$;

-- ---------------------------------------------------------------------------
-- Test 4: display abbreviates on the LAST surname, filing uses the FIRST
--
-- The decided rule, and the one most at risk of being "tidied" into a single
-- surname later. Maria displays as "Maria Santos" and files under Ferreira, and
-- both of those are correct at the same time.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_key text;
BEGIN
  v_key := name_sort_key('Maria Joana', 'Ferreira Silva Santos');

  IF v_key NOT LIKE 'Ferreira%' THEN
    RAISE EXCEPTION 'FAIL test 4: filed under "%" rather than Ferreira', v_key;
  END IF;

  IF short_name('Maria Joana', 'Ferreira Silva Santos') <> 'Maria Santos' THEN
    RAISE EXCEPTION 'FAIL test 4: the short name stopped using the last surname';
  END IF;

  -- The particle is kept for display and dropped for filing: she reads "Maria da
  -- Silva" and files under S, not under D with every other "da".
  IF name_sort_key('Maria', 'da Silva') NOT LIKE 'Silva%' THEN
    RAISE EXCEPTION 'FAIL test 4: "da Silva" filed under "%"',
      name_sort_key('Maria', 'da Silva');
  END IF;

  -- The given names are the tiebreak, so two Ferreiras have a stable order
  -- across pages of a paginated list rather than reshuffling.
  IF name_sort_key('Ana', 'Ferreira') >= name_sort_key('Bruno', 'Ferreira') THEN
    RAISE EXCEPTION 'FAIL test 4: two Ferreiras do not order by given name';
  END IF;

  RAISE NOTICE 'PASS test 4: the short name uses the last surname, filing uses the first';
END $$;

-- ---------------------------------------------------------------------------
-- Test 5: the register sorts in Portuguese — QA 32.4 and 32.7
--
-- Through real rows and the real index expression, not through the functions in
-- isolation: what the ticket asks for is the order the Alunos list comes back
-- in. Álvares must file with Alvares and both well ahead of Zeta — a plain
-- byte-order sort puts "Á" after "Z", which is the failure this collation exists
-- to prevent.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_org uuid; v_order text[];
BEGIN
  SELECT id INTO v_org FROM organization WHERE slug = 'clube-nomes';

  INSERT INTO student (organization_id, first_name, last_name) VALUES
    (v_org, 'Zé',          'Zeta'),
    (v_org, 'Élia',        'Álvares'),
    (v_org, 'Elia',        'Alvares'),
    (v_org, 'Maria',       'da Silva'),
    (v_org, 'Ana',         'Costa-Ribeiro'),
    (v_org, 'Maria Joana', 'Ferreira Silva Santos');

  SELECT array_agg(short_name(first_name, last_name)
                   ORDER BY name_sort_key(first_name, last_name) COLLATE pt_pt)
    INTO v_order
    FROM student
   WHERE organization_id = v_org AND archived_at IS NULL;

  IF v_order <> ARRAY['Elia Alvares', 'Élia Álvares', 'Ana Costa-Ribeiro',
                      'Maria Santos', 'Maria da Silva', 'Zé Zeta'] THEN
    RAISE EXCEPTION 'FAIL test 5: the register ordered as %', v_order;
  END IF;

  RAISE NOTICE 'PASS test 5: the register files by first surname, in Portuguese';
END $$;

-- ---------------------------------------------------------------------------
-- Test 6: a membership resolves its name the same way person_name does
--
-- Clerk owns the name where there is a login and the club's own columns answer
-- where there is not — decision 3, and the reason person_short_name exists
-- rather than every query coalescing the pair for itself. A guardian typed in by
-- the office and an instructor who signed in must abbreviate identically.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_org uuid; v_typed uuid; v_login uuid;
BEGIN
  SELECT id INTO v_org FROM organization WHERE slug = 'clube-nomes';

  -- Typed in by the office: no login, so the club's columns hold the name.
  INSERT INTO membership (organization_id, status, first_name, last_name)
  VALUES (v_org, 'active', 'Maria Fernanda', 'Ferreira dos Santos')
  RETURNING id INTO v_typed;

  IF person_short_name(v_typed) <> 'Maria dos Santos' THEN
    RAISE EXCEPTION 'FAIL test 6: a typed-in person abbreviates to %',
      person_short_name(v_typed);
  END IF;

  IF person_name(v_typed) <> 'Maria Fernanda Ferreira dos Santos' THEN
    RAISE EXCEPTION 'FAIL test 6: person_name returned %', person_name(v_typed);
  END IF;

  IF person_sort_key(v_typed) NOT LIKE 'Ferreira%' THEN
    RAISE EXCEPTION 'FAIL test 6: a typed-in person filed under %',
      person_sort_key(v_typed);
  END IF;

  -- The same human shape, but with a login: the name comes from Clerk's cache
  -- and must abbreviate by the identical rule.
  PERFORM provision_app_user('user_nomes', 'sofia@nomes.pt', 'Sofia Alexandra',
                             'Marques da Cunha', NULL, '2026-08-28 09:00:00+00');

  INSERT INTO membership (organization_id, app_user_id, status)
  SELECT v_org, id, 'active' FROM app_user WHERE clerk_user_id = 'user_nomes'
  RETURNING id INTO v_login;

  IF person_short_name(v_login) <> 'Sofia da Cunha' THEN
    RAISE EXCEPTION 'FAIL test 6: a signed-in person abbreviates to %',
      person_short_name(v_login);
  END IF;

  IF person_sort_key(v_login) NOT LIKE 'Marques%' THEN
    RAISE EXCEPTION 'FAIL test 6: a signed-in person filed under %',
      person_sort_key(v_login);
  END IF;

  RAISE NOTICE 'PASS test 6: Clerk-owned and club-owned names abbreviate identically';
END $$;

-- ---------------------------------------------------------------------------
-- Test 7: nothing is stored, so correcting a name corrects every form of it
--
-- Criterion 4. The abbreviated form is never a column somebody can edit, and it
-- can therefore never disagree with the parts — the failure would be a roster
-- still showing a misspelling that was fixed a month ago.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_org uuid; v_id uuid; v_short text;
BEGIN
  SELECT id INTO v_org FROM organization WHERE slug = 'clube-nomes';

  INSERT INTO student (organization_id, first_name, last_name)
  VALUES (v_org, 'Rirta', 'Simões Lopes') RETURNING id INTO v_id;

  UPDATE student SET first_name = 'Rita' WHERE id = v_id;

  SELECT short_name(first_name, last_name) INTO v_short FROM student WHERE id = v_id;
  IF v_short <> 'Rita Lopes' THEN
    RAISE EXCEPTION 'FAIL test 7: after correcting the name the short form is %', v_short;
  END IF;

  -- There is no column holding a composed name that could have gone stale.
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'student'
       AND column_name IN ('short_name', 'display_name', 'full_name', 'sort_key')
  ) THEN
    RAISE EXCEPTION 'FAIL test 7: a composed name is stored on student and can drift';
  END IF;

  RAISE NOTICE 'PASS test 7: composed names are derived, never stored, and cannot drift';
END $$;

ROLLBACK;
