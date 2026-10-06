-- Up Migration
--
-- POOLSE-66 slice 2b — what the management band needs and did not have.
--
-- Five changes, each small, each answering one widget:
--
-- 1. **Where a person's dashboard scope is remembered** — `membership`, not
--    `app_user`, because a site belongs to one club and a person can belong to
--    several. Null is "every site", which is the default the ticket asks for.
--    A composite foreign key, like every reference to a tenant row here: a
--    membership in club A must not be able to name club B's site, and RLS on
--    each row would let both pass. Sites are archived, never deleted, so there
--    is no ON DELETE; an archived site that is still remembered is read as
--    "every site" by the API rather than cleared by a trigger nobody would find.
--
-- 2. **Severity on an avaria or a reposição** — `maintenance_severity`, an enum
--    because only a developer changes the scale: low, normal, high. NOT NULL
--    DEFAULT 'normal', so every existing request is normal and every form that
--    predates the column keeps working without sending it.
--
-- 3. **How old a site's latest water analysis may be** — hours, per site,
--    nullable. Null means "not measured" and enforces nothing, which is the
--    house rule for every ceiling, interval and limit: never read it as zero.
--    A tank is due when its latest analysis is older than this, or it has none.
--    POOLSE-26's missing-reading alert can read the same column when it lands.
--
-- 4. and 5. **Two indexes the aggregates asked for**, found by the index check
--    the ticket makes part of the slice:
--    - `student_fee (organization_id, fee_plan_id)` for live lines — the money
--      widget reaches a site through the plan, and nothing indexed that join.
--    - `class_session (organization_id, pool_id, starts_at)` — today's classes
--      at a site are a range on `starts_at` behind a pool, and the existing
--      `(organization_id, starts_at)` index cannot narrow to the site.

ALTER TABLE membership
  ADD COLUMN dashboard_facility_id uuid,
  ADD CONSTRAINT membership_dashboard_facility_fk
    FOREIGN KEY (organization_id, dashboard_facility_id)
    REFERENCES facility (organization_id, id);

COMMENT ON COLUMN membership.dashboard_facility_id IS
  'The site this person''s dashboard is scoped to; null = every site. POOLSE-66 AC 10.';

CREATE TYPE maintenance_severity AS ENUM ('low', 'normal', 'high');

ALTER TABLE maintenance_request
  ADD COLUMN severity maintenance_severity NOT NULL DEFAULT 'normal';

ALTER TABLE facility
  ADD COLUMN water_analysis_max_age_hours integer
    CHECK (water_analysis_max_age_hours IS NULL OR water_analysis_max_age_hours > 0);

COMMENT ON COLUMN facility.water_analysis_max_age_hours IS
  'How old a tank''s latest water analysis may be before it is due. Null = not measured, enforces nothing.';

CREATE INDEX student_fee_plan_idx
  ON student_fee (organization_id, fee_plan_id)
  WHERE archived_at IS NULL;

CREATE INDEX class_session_pool_when_idx
  ON class_session (organization_id, pool_id, starts_at);

-- Down Migration

DROP INDEX IF EXISTS class_session_pool_when_idx;
DROP INDEX IF EXISTS student_fee_plan_idx;

ALTER TABLE facility DROP COLUMN IF EXISTS water_analysis_max_age_hours;

ALTER TABLE maintenance_request DROP COLUMN IF EXISTS severity;
DROP TYPE IF EXISTS maintenance_severity;

ALTER TABLE membership DROP CONSTRAINT IF EXISTS membership_dashboard_facility_fk;
ALTER TABLE membership DROP COLUMN IF EXISTS dashboard_facility_id;
