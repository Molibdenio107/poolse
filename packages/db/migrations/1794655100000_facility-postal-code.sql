-- Up Migration

/*
 * A site's postcode and distrito (Rui, 10-11-2026).
 *
 * `address` was one free-text box; it stays, now the street and number. Beside
 * it `postal_code`, Portugal's 0000-000, and `district`: one of the 18 distritos
 * or the two regiões autónomas when the site is in Portugal (the API holds the
 * list, `PT_DISTRICTS` in `@poolse/rules`), free text elsewhere. The locality is
 * `city` and the country is `country_code`, both the weather's town picker's:
 * one value each, never a second box for the same thing. Optional; the API
 * normalises `3800001` and `3800 001`.
 */

ALTER TABLE facility
  ADD COLUMN postal_code text,
  ADD COLUMN district text,
  ADD CONSTRAINT facility_postal_code_format
    CHECK (postal_code IS NULL OR postal_code ~ '^[0-9]{4}-[0-9]{3}$'),
  ADD CONSTRAINT facility_district_length
    CHECK (district IS NULL OR char_length(district) BETWEEN 1 AND 80);

-- Down Migration

ALTER TABLE facility
  DROP CONSTRAINT IF EXISTS facility_district_length,
  DROP CONSTRAINT IF EXISTS facility_postal_code_format,
  DROP COLUMN IF EXISTS district,
  DROP COLUMN IF EXISTS postal_code;
