-- Up Migration

-- POOLSE-89: a backup must restore, and two functions stopped it.
--
-- `pg_restore` runs with `search_path` set to '' — on purpose, so a restored
-- object can never resolve a name to something planted in another schema. A
-- function that sits inside an index or a constraint is executed while the
-- restore rebuilds it, and a call it makes to another of our functions without
-- `public.` then resolves to nothing:
--
--   closure_span()  calls closure_half_day_cut()  — closure_no_overlap (EXCLUDE)
--   name_sort_key() calls surname_units()         — the name-order indexes
--   surname_units() calls strip_accents()         — the same indexes, one level down
--
-- The first restore drill failed on the first of these, which is exactly what
-- the drill exists to find: every nightly dump until now was a file that could
-- not have brought a club back.
--
-- **Qualified, not pinned.** `ALTER FUNCTION … SET search_path` would also work,
-- but a SQL function with a SET clause is never inlined, and name_sort_key()
-- orders every people list. Writing `public.` keeps both inlinable and changes
-- nothing they return; the indexes stay valid.
--
-- A new SQL or plpgsql function used by an index, a constraint or a generated
-- column calls our other functions as `public.<name>()`. The restore drill
-- (`pnpm --filter @poolse/db backup:test`) is what catches the one that does not.

CREATE OR REPLACE FUNCTION public.closure_span(p_starts_on date, p_ends_on date, p_part closure_part_of_day)
 RETURNS tsrange
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
AS $function$
  SELECT CASE p_part
           WHEN 'morning'   THEN tsrange(p_starts_on::timestamp,
                                         p_starts_on + public.closure_half_day_cut(), '[)')
           WHEN 'afternoon' THEN tsrange(p_starts_on + public.closure_half_day_cut(),
                                         (p_ends_on + 1)::timestamp, '[)')
           ELSE tsrange(p_starts_on::timestamp, (p_ends_on + 1)::timestamp, '[)')
         END
$function$

;
CREATE OR REPLACE FUNCTION public.name_sort_key(p_given text, p_surnames text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT btrim(
    coalesce(
      nullif(
        btrim(regexp_replace(
          -- The first surname unit, with any leading particles removed.
          coalesce((SELECT u[1] FROM public.surname_units(p_surnames) u), ''),
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
$function$

;

CREATE OR REPLACE FUNCTION public.surname_units(p_surnames text)
 RETURNS text[]
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
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
    v_bare := lower(public.strip_accents(rtrim(v_token, '.')));

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
$function$
;

-- Down Migration

CREATE OR REPLACE FUNCTION public.closure_span(p_starts_on date, p_ends_on date, p_part closure_part_of_day)
 RETURNS tsrange
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
AS $function$
  SELECT CASE p_part
           WHEN 'morning'   THEN tsrange(p_starts_on::timestamp,
                                         p_starts_on + closure_half_day_cut(), '[)')
           WHEN 'afternoon' THEN tsrange(p_starts_on + closure_half_day_cut(),
                                         (p_ends_on + 1)::timestamp, '[)')
           ELSE tsrange(p_starts_on::timestamp, (p_ends_on + 1)::timestamp, '[)')
         END
$function$

;
CREATE OR REPLACE FUNCTION public.name_sort_key(p_given text, p_surnames text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
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
$function$

;

CREATE OR REPLACE FUNCTION public.surname_units(p_surnames text)
 RETURNS text[]
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
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
$function$
;
