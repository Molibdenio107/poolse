-- Up Migration
--
-- A turma's own colour on the grid — round 6.
--
-- The calendar colours a block by its level, which answers "what kind of class
-- is this" and cannot answer "which one is mine". A club wanting Competição A
-- to stand out from Competição B had no way to say so.
--
-- ---------------------------------------------------------------------------
-- An enum, not a hex, and that is the whole design
-- ---------------------------------------------------------------------------
--
-- `booking_category.colour` made this decision already and it holds here for the
-- same three reasons, written out again because a colour picker is exactly the
-- feature that tempts somebody to reach for `text`:
--
--   * CLAUDE.md's rule is that colour comes from tokens and no literal hex
--     appears in a component. A stored hex is a literal hex that arrived by
--     another route.
--   * Light and dark are two different paintings of the same token. A hex is
--     one colour, so it is either right on the dark theme or right on the light
--     one, and the club that picked it only ever saw one of them.
--   * Contrast. Every one of the eight values below is a token whose ratio was
--     measured in both themes — white on the block at 4.6:1 or better. A free
--     picker lets a club choose pale yellow, and the block's own text goes to
--     1.3:1 with nothing to warn them.
--
-- `parceria` remains the exception: `partner.colour` is a hex, predating this,
-- and is not being changed by a slice about turmas.
--
-- The names are the tints', not the levels' — a value here means "the fourth
-- colour", not "the fourth level", so reordering the club's levels does not
-- silently repaint every turma that chose one.

CREATE TYPE class_colour AS ENUM (
  'teal',
  'green',
  'lime',
  'amber',
  'orange',
  'rose',
  'magenta',
  'violet'
);

/*
 * Nullable, and null is the ordinary state.
 *
 * Null means "nobody chose", and the calendar falls back to the level's tint —
 * which is what the whole club looks like today and goes on looking like until
 * somebody picks something. A default of `teal` would have repainted every
 * turma in the country on deploy and made "not chosen" unrepresentable.
 */
ALTER TABLE class_group
  ADD COLUMN colour class_colour;

COMMENT ON COLUMN class_group.colour IS
  'The turma''s own colour on the grid. Null means not chosen: the calendar falls back to the level''s tint. A token, never a hex — see the migration.';

-- Down Migration

ALTER TABLE class_group
  DROP COLUMN IF EXISTS colour;

DROP TYPE IF EXISTS class_colour;
