-- Up Migration
--
-- Where a site actually is — backlog round 3, story 3.
--
-- The free-text `address` stays exactly as it is. It is what goes on an invoice
-- and what a parent types into a maps app, and neither of those wants a
-- structured breakdown of a Portuguese street name.
--
-- What is added beside it is a *place*: a city chosen from Open-Meteo's geocoder,
-- with the coordinates it came back with. The coordinates are the point. Storing
-- only "Aveiro" would mean geocoding on every render — slow, wasteful of a quota,
-- and a screen that breaks whenever somebody else's geocoder is down. Resolved
-- once, at the moment a person picks from a list and can see whether it is the
-- right Aveiro.
--
-- This also unblocks the municipal holiday that `apps/api/src/classes/holidays.ts`
-- says it cannot compute, because "Poolse does not know which town a pool is in".
-- After this, it does.

ALTER TABLE facility
  ADD COLUMN city         text,
  ADD COLUMN country_code char(2),
  ADD COLUMN latitude     numeric(9,6),
  ADD COLUMN longitude    numeric(9,6);

COMMENT ON COLUMN facility.city IS
  'Display name as the geocoder returned it — "Aveiro", not a slug.';
COMMENT ON COLUMN facility.country_code IS
  'ISO 3166-1 alpha-2, uppercase. Disambiguates the six other places called Aveiro.';
COMMENT ON COLUMN facility.latitude IS
  'Degrees. numeric(9,6) is roughly 0.1 m — far more than a weather lookup needs, and exact.';
COMMENT ON COLUMN facility.longitude IS 'Degrees.';

-- Blank is not a city, and an untouched form field sends one.
ALTER TABLE facility
  ADD CONSTRAINT facility_city_not_blank
  CHECK (city IS NULL OR btrim(city) <> '');

ALTER TABLE facility
  ADD CONSTRAINT facility_country_code_shape
  CHECK (country_code IS NULL OR country_code ~ '^[A-Z]{2}$');

ALTER TABLE facility
  ADD CONSTRAINT facility_latitude_range
  CHECK (latitude IS NULL OR (latitude >= -90 AND latitude <= 90));

ALTER TABLE facility
  ADD CONSTRAINT facility_longitude_range
  CHECK (longitude IS NULL OR (longitude >= -180 AND longitude <= 180));

-- Half a coordinate is not a location. Without this, a partial write leaves a row
-- that looks placed and cannot be plotted, and the weather panel would have to
-- carry a branch for a state that should never exist.
ALTER TABLE facility
  ADD CONSTRAINT facility_coordinates_complete
  CHECK ((latitude IS NULL) = (longitude IS NULL));

-- Down Migration

ALTER TABLE facility DROP CONSTRAINT IF EXISTS facility_coordinates_complete;
ALTER TABLE facility DROP CONSTRAINT IF EXISTS facility_longitude_range;
ALTER TABLE facility DROP CONSTRAINT IF EXISTS facility_latitude_range;
ALTER TABLE facility DROP CONSTRAINT IF EXISTS facility_country_code_shape;
ALTER TABLE facility DROP CONSTRAINT IF EXISTS facility_city_not_blank;

ALTER TABLE facility
  DROP COLUMN IF EXISTS longitude,
  DROP COLUMN IF EXISTS latitude,
  DROP COLUMN IF EXISTS country_code,
  DROP COLUMN IF EXISTS city;
