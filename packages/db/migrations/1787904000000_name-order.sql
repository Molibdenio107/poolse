-- Names read first name + surname — POOLSE-32.
--
-- "Silva, Maria" is filing-cabinet notation. Nobody says it out loud, and an
-- instructor reading a roster at the poolside on a phone has to mentally
-- re-order every row. This migration puts the three name questions in one place
-- so that no screen has to answer them for itself.
--
-- **They are three separate questions and must never be conflated:**
--
--   display order   first name before surname, everywhere        "Maria Silva"
--   abbreviation    first given name + last surname, in lists    "Maria Santos"
--   sort order      by surname, so a list scans                  files under F
--
-- The order people read and the order they scan by are different things, and a
-- screen that uses one for the other is how "Silva, Maria" got here.
--
-- **Why this lives in SQL rather than in the API.**
--
-- Criterion 4 says the abbreviated form is derived, never stored, so it cannot
-- drift from the parts. Criterion 5 says lists sort by surname — and POOLSE-29
-- paginates server-side, so a sort in JavaScript would only order the fifteen
-- rows already on the page. That second requirement forces the sort key into the
-- database, and once one of the three lives here, putting the other two anywhere
-- else guarantees the day somebody fixes a particle bug in one copy only. So
-- there is exactly one implementation, it is this one, and every query selects
-- the composed forms rather than composing them again.
--
-- Nothing is stored. These are pure functions of columns that already exist, so
-- correcting a name corrects every form of it in the same write — criterion 4.

-- Up Migration

-- ---------------------------------------------------------------------------
-- pt_pt — a Portuguese collation
--
-- `lower()` and `strip_accents()` are not enough for ordering, which is why this
-- exists alongside them rather than instead of them. Folding accents away files
-- "Álvares" as "alvares", which is right, but it also makes "Alvares" and
-- "Álvares" indistinguishable and leaves their relative order to whatever the
-- rows happened to be inserted in. ICU treats the accent as a tiebreak: the two
-- file together, in a stable order, and both come well before "Zé".
--
-- ICU is compiled into the postgres:16 image and into every managed Postgres
-- this could deploy to, so this needs nothing enabled.
-- ---------------------------------------------------------------------------

CREATE COLLATION pt_pt (provider = icu, locale = 'pt-PT');

COMMENT ON COLLATION pt_pt IS
  'Portuguese ordering for names — POOLSE-32. Accents are a tiebreak rather than '
  'a separate letter, so Alvares and Alvares file together and ahead of Ze.';

-- ---------------------------------------------------------------------------
-- surname_units — the part everything else is built on
--
-- A Portuguese surname is not "the tokens after the first space". It is a
-- sequence of *units*, and a unit can be several words:
--
--   'Ferreira Silva Santos'  →  {Ferreira, Silva, Santos}    three units
--   'da Silva'               →  {"da Silva"}                 one: a particle
--                                                            belongs to the name
--                                                            after it
--   'dos Santos Costa'       →  {"dos Santos", Costa}        two
--   'de Sousa e Melo'        →  {"de Sousa e Melo"}          one: "e" joins two
--                                                            surnames into a
--                                                            compound
--   'Costa-Ribeiro'          →  {Costa-Ribeiro}              a hyphen is not a
--                                                            space and never splits
--
-- The ticket names the likely mistake exactly: assuming the last whitespace
-- token is the surname. That assumption abbreviates "Maria da Silva" to "Maria
-- da", which is not a name, and it fails silently on a printed roster.
--
-- Two token classes, and they behave differently:
--
--   a *particle* (de, da, dos, van…) attaches forward, to the word after it
--   a *joiner*   (e, y)              attaches backward and forward at once,
--                                    merging the units on either side
-- ---------------------------------------------------------------------------

CREATE FUNCTION surname_units(p_surnames text) RETURNS text[]
LANGUAGE plpgsql
IMMUTABLE
AS $fn$
DECLARE
  /*
   * Portuguese first, then the ones that arrive with a foreign parent and would
   * otherwise be mangled on a roster. A literal array rather than a lookup table
   * on purpose: an operator cannot usefully add to this, it changes about never,
   * and reading a table would make the function non-IMMUTABLE and therefore
   * unindexable.
   */
  c_particles constant text[] := ARRAY[
    'de', 'do', 'da', 'dos', 'das', 'd',
    'del', 'della', 'di', 'du',
    'van', 'von', 'der', 'den', 'ter', 'la', 'le', 'los', 'las'
  ];
  -- "Sousa e Melo" is one surname, not two. So is the Spanish "y".
  c_joiners constant text[] := ARRAY['e', 'y'];

  v_tokens  text[];
  v_token   text;
  v_bare    text;
  v_units   text[] := ARRAY[]::text[];
  -- Particles seen but not yet attached to anything.
  v_pending text := '';
  -- Set by a joiner: the next unit merges into the previous one.
  v_merge   boolean := false;
  v_last    int;
BEGIN
  IF p_surnames IS NULL OR btrim(p_surnames) = '' THEN
    RETURN ARRAY[]::text[];
  END IF;

  v_tokens := regexp_split_to_array(btrim(p_surnames), '\s+');

  FOREACH v_token IN ARRAY v_tokens LOOP
    /*
     * Accents stripped and trailing punctuation dropped for the comparison only.
     * The token itself is appended exactly as it was typed — this decides what a
     * word *is*, never how it is spelled.
     */
    v_bare := lower(strip_accents(rtrim(v_token, '.')));

    IF v_bare = ANY (c_joiners) THEN
      -- Carry the joiner itself, so the merged unit reads "Sousa e Melo" rather
      -- than "Sousa Melo".
      v_pending := btrim(v_pending || ' ' || v_token);
      v_merge := true;

    ELSIF v_bare = ANY (c_particles) THEN
      v_pending := btrim(v_pending || ' ' || v_token);

    ELSE
      -- A head word. It closes whatever particles were waiting.
      v_last := array_length(v_units, 1);
      IF v_merge AND v_last IS NOT NULL THEN
        v_units[v_last] := btrim(v_units[v_last] || ' ' || v_pending || ' ' || v_token);
      ELSE
        v_units := v_units || btrim(v_pending || ' ' || v_token);
      END IF;
      v_pending := '';
      v_merge := false;
    END IF;
  END LOOP;

  /*
   * Particles left with nothing to attach to — a name ending "Silva de", or one
   * that is only "de". Rare, and probably a typo, but a name is somebody's and
   * this function must never drop part of one. They join the last unit, or
   * become one if there is no other.
   */
  IF v_pending <> '' THEN
    v_last := array_length(v_units, 1);
    IF v_last IS NULL THEN
      v_units := ARRAY[v_pending];
    ELSE
      v_units[v_last] := btrim(v_units[v_last] || ' ' || v_pending);
    END IF;
  END IF;

  RETURN v_units;
END;
$fn$;

COMMENT ON FUNCTION surname_units(text) IS
  'A surname string split into units, particle- and joiner-aware — POOLSE-32. '
  '"de Sousa e Melo" is one unit; "dos Santos Costa" is two.';

-- ---------------------------------------------------------------------------
-- display_name — criterion 1
--
-- First name before surname, every part kept. This is the full legal name: the
-- detail page, and every document, export and invoice. No abbreviation ever
-- reaches a document, which is why this and short_name are two functions rather
-- than one with a flag somebody forgets to pass.
-- ---------------------------------------------------------------------------

CREATE FUNCTION display_name(p_given text, p_surnames text) RETURNS text
LANGUAGE sql
IMMUTABLE
AS $fn$
  SELECT nullif(
    btrim(coalesce(btrim(p_given), '') || ' ' || coalesce(btrim(p_surnames), '')),
    ''
  );
$fn$;

COMMENT ON FUNCTION display_name(text, text) IS
  'The full legal name, first name first — POOLSE-32 criteria 1 and 3. Never '
  'abbreviated: detail pages, documents, exports and invoices use this.';

-- ---------------------------------------------------------------------------
-- short_name — criterion 2
--
-- First given name plus the last surname unit. "Maria Joana Ferreira Silva
-- Santos" is "Maria Santos": five parts break a turma card, and the two that
-- identify her at a glance are the first and the last.
--
-- **The particle stays** — "Maria da Silva" abbreviates to "Maria da Silva",
-- not "Maria Silva". Decided rather than defaulted: the particle is part of the
-- surname to the person who has it, keeping it is never wrong, and dropping it
-- buys three characters.
--
-- A single-part name ("Madonna") returns that one part, with no stray space and
-- no error.
-- ---------------------------------------------------------------------------

CREATE FUNCTION short_name(p_given text, p_surnames text) RETURNS text
LANGUAGE sql
IMMUTABLE
AS $fn$
  SELECT nullif(
    btrim(
      -- The first given name only. "Maria Joana" on a roster is "Maria".
      coalesce((regexp_split_to_array(btrim(coalesce(p_given, '')), '\s+'))[1], '')
      || ' ' ||
      coalesce((SELECT u[array_length(u, 1)] FROM surname_units(p_surnames) u), '')
    ),
    ''
  );
$fn$;

COMMENT ON FUNCTION short_name(text, text) IS
  'First given name + last surname unit, for lists, cards, rosters and the '
  'calendar — POOLSE-32 criterion 2. Particles are kept: "Maria da Silva".';

-- ---------------------------------------------------------------------------
-- name_sort_key — criterion 5
--
-- **The first surname files the person**, not the last. Settled in the backlog
-- round: "Maria Joana Ferreira Silva Santos" files under Ferreira.
--
-- Note that this is deliberately *not* the surname short_name shows. Display
-- abbreviation keeps the last surname because that is what identifies somebody
-- at a glance; filing uses the first because that is where a person looks.
-- Conflating them would have made one of the two wrong, which is why the ticket
-- insists they are separate questions.
--
-- Leading particles are dropped from the key only — "Maria da Silva" files under
-- Silva, where somebody looking for her will look, while still *displaying* with
-- the "da". Filing under D would bury every da/de/dos name in one meaningless
-- block near the top of every list.
--
-- The given names are appended as the tiebreak, so two Ferreiras have a stable
-- order and page 2 of POOLSE-29 continues page 1 rather than reshuffling.
-- Ordering applies `COLLATE pt_pt` to this key; the key itself is plain text so
-- it can be compared, logged and indexed without surprise.
-- ---------------------------------------------------------------------------

CREATE FUNCTION name_sort_key(p_given text, p_surnames text) RETURNS text
LANGUAGE sql
IMMUTABLE
AS $fn$
  SELECT btrim(
    coalesce(
      nullif(
        btrim(regexp_replace(
          -- The first surname unit, with any leading particles removed.
          coalesce((SELECT u[1] FROM surname_units(p_surnames) u), ''),
          '^(?:(de|do|da|dos|das|d|del|della|di|du|van|von|der|den|ter|la|le|los|las)\.?\s+)+',
          '',
          'i'
        )),
        ''
      ),
      -- No surname at all: the one part is its own surname, so "Madonna" files
      -- under M rather than under nothing.
      btrim(coalesce(p_given, ''))
    )
    || ' ' || coalesce(btrim(p_given), '')
  );
$fn$;

COMMENT ON FUNCTION name_sort_key(text, text) IS
  'Files a person by their first surname, leading particles stripped, given names '
  'as the tiebreak — POOLSE-32 criterion 5. Order it with COLLATE pt_pt.';

-- ---------------------------------------------------------------------------
-- The membership overloads
--
-- `person_name` already states where a person's name comes from — Clerk's cache
-- when there is a login, the club's own columns when there is not. These resolve
-- the same way and then delegate, so that rule stays written once.
--
-- STABLE rather than IMMUTABLE, because they read a table. That is also why
-- membership gets no expression index below: the resolved name depends on a join
-- to app_user, so there is no expression on membership alone to index. The staff
-- and guardian lists are tens of rows behind RLS, where a sort is free; the
-- student register is the one that grows, and it has plain columns.
-- ---------------------------------------------------------------------------

CREATE FUNCTION person_short_name(p_membership_id uuid) RETURNS text
LANGUAGE sql STABLE
AS $fn$
  SELECT short_name(coalesce(u.cached_first_name, m.first_name),
                    coalesce(u.cached_last_name,  m.last_name))
    FROM membership m
    LEFT JOIN app_user u ON u.id = m.app_user_id
   WHERE m.id = p_membership_id;
$fn$;

CREATE FUNCTION person_sort_key(p_membership_id uuid) RETURNS text
LANGUAGE sql STABLE
AS $fn$
  SELECT name_sort_key(coalesce(u.cached_first_name, m.first_name),
                       coalesce(u.cached_last_name,  m.last_name))
    FROM membership m
    LEFT JOIN app_user u ON u.id = m.app_user_id
   WHERE m.id = p_membership_id;
$fn$;

COMMENT ON FUNCTION person_short_name(uuid) IS
  'short_name for a membership, resolving Clerk''s cache exactly as person_name '
  'does — POOLSE-32.';

-- ---------------------------------------------------------------------------
-- The register, in the order it is now displayed
--
-- `student_name_idx` ordered by (last_name, first_name) — the raw columns, which
-- is neither the surname this ticket files by nor a Portuguese ordering. It is
-- replaced rather than kept alongside: leaving it would leave an index matching
-- no query, and the next tired evening would sort by it because it is there.
-- ---------------------------------------------------------------------------

DROP INDEX IF EXISTS student_name_idx;

CREATE INDEX student_sort_name_idx
  ON student (organization_id, name_sort_key(first_name, last_name) COLLATE pt_pt)
  WHERE archived_at IS NULL;

-- Down Migration

DROP INDEX IF EXISTS student_sort_name_idx;

CREATE INDEX student_name_idx
  ON student (organization_id, last_name, first_name)
  WHERE archived_at IS NULL;

DROP FUNCTION IF EXISTS person_sort_key(uuid);
DROP FUNCTION IF EXISTS person_short_name(uuid);
DROP FUNCTION IF EXISTS name_sort_key(text, text);
DROP FUNCTION IF EXISTS short_name(text, text);
DROP FUNCTION IF EXISTS display_name(text, text);
DROP FUNCTION IF EXISTS surname_units(text);

DROP COLLATION IF EXISTS pt_pt;
