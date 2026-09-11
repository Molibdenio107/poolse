-- A personal organization — slice 4.5.
--
-- Test 1 is the slice: a person signing up for their own pool lands with a tank
-- to record readings against, and no season, because a season is what turmas
-- live in and there are none. Test 2 is the other half of the same change — the
-- four-argument call every existing caller makes still provisions a club exactly
-- as before, or the harness and every test built on it would have moved.
--
-- Test 3 keeps `resolve_memberships` honest: the kind reaches `/me`, which is
-- the one round trip the navigation is shaped from.
--
-- Run: pnpm db:test

\set ON_ERROR_STOP on
BEGIN;

SELECT provision_app_user('user_home', 'casa@exemplo.pt', 'Ana', 'Lopes', NULL,
                          '2026-08-26 09:00:00+00');
SELECT provision_app_user('user_club', 'clube@exemplo.pt', 'Bruno', 'Sá', NULL,
                          '2026-08-26 09:00:00+00');

-- ---------------------------------------------------------------------------
-- Test 1: a personal tenant opens with a pool and no season
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_org uuid; v_facility uuid; v_pool uuid; v_kind text;
  v_pools int; v_seasons int; v_lanes int; v_roles text[];
BEGIN
  SELECT o_organization_id, o_facility_id, o_pool_id
    INTO v_org, v_facility, v_pool
    FROM provision_organization('user_home', 'Piscina de casa', 'pt-PT', NULL, 'personal');

  SELECT kind::text INTO v_kind FROM organization WHERE id = v_org;
  IF v_kind <> 'personal' THEN
    RAISE EXCEPTION 'FAIL test 1: organization kind is %, expected personal', v_kind;
  END IF;

  IF v_pool IS NULL THEN
    RAISE EXCEPTION 'FAIL test 1: no pool id returned';
  END IF;

  SELECT count(*) INTO v_pools
    FROM pool WHERE organization_id = v_org AND facility_id = v_facility AND id = v_pool
                AND archived_at IS NULL AND name = 'Piscina de casa' AND kind = 'outdoor';
  IF v_pools <> 1 THEN
    RAISE EXCEPTION 'FAIL test 1: expected one outdoor pool named after the site, found %', v_pools;
  END IF;

  -- The default-lanes trigger fired, so the calendar's "sem pista" column will
  -- never be the only one on this tank — not that a personal user will see it.
  SELECT count(*) INTO v_lanes FROM lane WHERE organization_id = v_org AND pool_id = v_pool;
  IF v_lanes <> 1 THEN
    RAISE EXCEPTION 'FAIL test 1: expected the default lane, found %', v_lanes;
  END IF;

  SELECT count(*) INTO v_seasons FROM season WHERE organization_id = v_org;
  IF v_seasons <> 0 THEN
    RAISE EXCEPTION 'FAIL test 1: a personal tenant got % seasons', v_seasons;
  END IF;

  SELECT array_agg(role::text) INTO v_roles
    FROM membership_role WHERE organization_id = v_org AND archived_at IS NULL;
  IF v_roles <> ARRAY['owner'] THEN
    RAISE EXCEPTION 'FAIL test 1: expected the caller as owner, got %', v_roles;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM audit_log
     WHERE organization_id = v_org AND action = 'pool.created' AND entity_id = v_pool
  ) THEN
    RAISE EXCEPTION 'FAIL test 1: the pool was created without an audit entry';
  END IF;

  RAISE NOTICE 'PASS test 1: a personal tenant opens with a pool and no season';
END $$;

-- ---------------------------------------------------------------------------
-- Test 2: the four-argument call still provisions a club
--
-- Every caller before this slice — the harness, five suites, the API — passes
-- four arguments. The default on the fifth is what keeps them all meaning
-- "business", and the old overload had to go or the call would be ambiguous.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_org uuid; v_pool uuid; v_kind text; v_pools int; v_seasons int;
BEGIN
  SELECT o_organization_id, o_pool_id INTO v_org, v_pool
    FROM provision_organization('user_club', 'Clube de Bairro', 'pt-PT', 'Piscina do Bairro');

  SELECT kind::text INTO v_kind FROM organization WHERE id = v_org;
  IF v_kind <> 'business' THEN
    RAISE EXCEPTION 'FAIL test 2: organization kind is %, expected business', v_kind;
  END IF;

  IF v_pool IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL test 2: a club was given a pool at signup';
  END IF;

  SELECT count(*) INTO v_pools FROM pool WHERE organization_id = v_org;
  SELECT count(*) INTO v_seasons FROM season WHERE organization_id = v_org AND archived_at IS NULL;
  IF v_pools <> 0 OR v_seasons <> 1 THEN
    RAISE EXCEPTION 'FAIL test 2: a club got % pools and % seasons', v_pools, v_seasons;
  END IF;

  RAISE NOTICE 'PASS test 2: a club still opens with a season and no pool';
END $$;

-- ---------------------------------------------------------------------------
-- Test 3: resolve_memberships carries the kind
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_home text; v_club text;
BEGIN
  SELECT o_organization_kind INTO v_home FROM resolve_memberships('user_home');
  SELECT o_organization_kind INTO v_club FROM resolve_memberships('user_club');

  IF v_home IS DISTINCT FROM 'personal' OR v_club IS DISTINCT FROM 'business' THEN
    RAISE EXCEPTION 'FAIL test 3: resolve_memberships says % and %, expected personal and business',
      v_home, v_club;
  END IF;

  RAISE NOTICE 'PASS test 3: the membership says which kind of tenant it is in';
END $$;

ROLLBACK;
