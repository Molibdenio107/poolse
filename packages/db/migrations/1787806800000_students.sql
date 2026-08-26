-- Up Migration
--
-- Phase 1.2: students and the levels they progress through.
--
-- The roadmap sets the bar at "50 students manageable without pain", which is a
-- statement about the list rather than the record: searching by name has to work
-- the way a Portuguese operator types, and filtering by level has to be one
-- click. Both are decided here rather than in the query layer.
--
-- What is deliberately NOT here: anything medical. `student_sensitive` and
-- `consent` are slice 1.3, stored in separate tables so access to them can be
-- restricted and logged independently of ordinary student data. Most students
-- are minors and medical notes about them are special-category data under GDPR;
-- mixing them into this table now would mean unpicking it later, with a period
-- of history that has no audit trail. See docs/product.md, "on students being
-- children".
--
-- The `notes` column here is for the ordinary kind — "prefers the shallow end",
-- "sibling of Ana". The form says so, because a free-text box on a child's
-- record is exactly where somebody will type an allergy otherwise.

-- ---------------------------------------------------------------------------
-- strip_accents
--
-- Lifted out of slugify(), which was doing the same work inline, because search
-- needs it too: an operator typing "joao" must find "João", and one typing
-- "JOÃO" must find him as well. Portuguese names make this a correctness
-- requirement rather than a nicety.
--
-- Still translate() rather than the `unaccent` extension: IMMUTABLE, so it can
-- be indexed, and nothing to enable on whichever managed Postgres this lands on.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION strip_accents(p_text text) RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT translate(
    coalesce(p_text, ''),
    'áàâãäéèêëíìîïóòôõöúùûüçñÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑ',
    'aaaaaeeeeiiiiooooouuuucnAAAAAEEEEIIIIOOOOOUUUUCN'
  );
$$;

CREATE OR REPLACE FUNCTION slugify(p_text text) RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT trim(BOTH '-' FROM
    regexp_replace(
      regexp_replace(lower(strip_accents(p_text)), '[^a-z0-9]+', '-', 'g'),
      '-{2,}', '-', 'g'
    )
  );
$$;

-- ---------------------------------------------------------------------------
-- student_level — a lookup, not an enum
--
-- Every school names its progression differently: Adaptação / Iniciação /
-- Aperfeiçoamento at one pool, Nível 1..5 at the next. An enum would mean a
-- migration every time an operator renamed a level, which is why the data model
-- draws the line here (decision: "enumerations as lookup tables where an
-- operator might add to it").
-- ---------------------------------------------------------------------------

CREATE TABLE student_level (
  id              uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organization (id),
  name            text NOT NULL,
  -- A progression is an ordered thing; alphabetical would put Aperfeiçoamento
  -- before Iniciação, which is backwards.
  sort_order      integer NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  archived_at     timestamptz,
  PRIMARY KEY (id),
  UNIQUE (organization_id, id),
  CHECK (btrim(name) <> '')
);

CREATE UNIQUE INDEX student_level_name_uq
  ON student_level (organization_id, lower(strip_accents(name)))
  WHERE archived_at IS NULL;

CREATE INDEX student_level_order_idx
  ON student_level (organization_id, sort_order)
  WHERE archived_at IS NULL;

CREATE TRIGGER student_level_updated_at BEFORE UPDATE ON student_level
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- student
-- ---------------------------------------------------------------------------

CREATE TABLE student (
  id              uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organization (id),
  first_name      text NOT NULL,
  last_name       text NOT NULL,
  birth_date      date,
  level_id        uuid,

  -- Nullable until phase 3, when students get their own accounts. The column
  -- exists now so the eventual link has somewhere to go without a migration
  -- against a populated table.
  app_user_id     uuid REFERENCES app_user (id),

  -- Ordinary notes only. Medical information belongs in student_sensitive
  -- (slice 1.3) and the form says so.
  notes           text,

  -- The guardian's, in practice: most students are children and the contact
  -- details on a child's record are their parent's.
  contact_email   citext,
  contact_phone   text,

  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  archived_at     timestamptz,

  PRIMARY KEY (id),
  UNIQUE (organization_id, id),

  -- The composite reference: a student cannot be put in another organization's
  -- level, whatever id arrives in the request.
  FOREIGN KEY (organization_id, level_id) REFERENCES student_level (organization_id, id),

  CHECK (btrim(first_name) <> ''),
  CHECK (btrim(last_name) <> ''),
  -- A birth date before this is a typo, every time. The upper bound cannot be a
  -- CHECK because current_date is not IMMUTABLE, so the API refuses future dates.
  CHECK (birth_date IS NULL OR birth_date > DATE '1900-01-01')
);

-- Deliberately no unique constraint on a student's name. Two children called
-- Maria Silva at one pool is ordinary, and a constraint here would reject the
-- second one — or worse, push an operator into inventing "Maria Silva 2".
-- Duplicate detection belongs in the Excel importer (1.10), where a human
-- confirms it.

-- The list, in the order it is displayed.
CREATE INDEX student_name_idx
  ON student (organization_id, last_name, first_name)
  WHERE archived_at IS NULL;

-- Search is accent- and case-insensitive over the whole name, so "joao s" finds
-- "João Silva" and "JOAO" finds him too.
--
-- Be clear about what this index does and does not do: a btree cannot serve an
-- infix `LIKE '%term%'`, which is what operators expect from a search box, so
-- that query scans. At a few hundred students per organization — already scoped
-- to one tenant by RLS — a scan is nothing. What the index does buy is exact and
-- prefix lookups on the normalised name, which the importer will want in 1.10
-- when it checks whether a row already exists. If a customer ever arrives with
-- thousands of students, the answer is pg_trgm and a GIN index, not this.
CREATE INDEX student_search_idx
  ON student (organization_id, lower(strip_accents(first_name || ' ' || last_name)))
  WHERE archived_at IS NULL;

CREATE INDEX student_level_idx
  ON student (organization_id, level_id)
  WHERE archived_at IS NULL;

CREATE TRIGGER student_updated_at BEFORE UPDATE ON student
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- Row-level security
--
-- Same policy as every other tenant table. New tables inherit SELECT/INSERT/
-- UPDATE/DELETE for poolse_app from the ALTER DEFAULT PRIVILEGES in slice 0.3,
-- so only the policies need stating.
-- ---------------------------------------------------------------------------

ALTER TABLE student_level ENABLE ROW LEVEL SECURITY;
ALTER TABLE student       ENABLE ROW LEVEL SECURITY;

CREATE POLICY student_level_tenant ON student_level
  USING (organization_id = current_organization_id())
  WITH CHECK (organization_id = current_organization_id());

CREATE POLICY student_tenant ON student
  USING (organization_id = current_organization_id())
  WITH CHECK (organization_id = current_organization_id());

-- Down Migration

DROP POLICY IF EXISTS student_tenant ON student;
DROP POLICY IF EXISTS student_level_tenant ON student_level;

DROP TABLE IF EXISTS student;
DROP TABLE IF EXISTS student_level;

CREATE OR REPLACE FUNCTION slugify(p_text text) RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT trim(BOTH '-' FROM
    regexp_replace(
      regexp_replace(
        lower(translate(
          coalesce(p_text, ''),
          'áàâãäéèêëíìîïóòôõöúùûüçñÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑ',
          'aaaaaeeeeiiiiooooouuuucnaaaaaeeeeiiiiooooouuuucn'
        )),
        '[^a-z0-9]+', '-', 'g'
      ),
      '-{2,}', '-', 'g'
    )
  );
$$;

DROP FUNCTION IF EXISTS strip_accents(text);
