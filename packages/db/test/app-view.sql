-- See the app as a real person — POOLSE-188.
--
-- Test 1: a live view resolves, with only the home's roles. Test 2: every way a
-- view stops being live (demoted reader, departed person, lost role, a viewed
-- person who becomes Owner, time). Test 3: a support view is bound to its grant.
-- Test 4: the record cannot be rewritten, and an hour is the ceiling. Test 5:
-- another club reads nothing, writes nothing, and a composite key refuses a row
-- that points across clubs.
--
-- Run: pnpm db:test

\set ON_ERROR_STOP on
BEGIN;

INSERT INTO organization (id, name, slug) VALUES
  ('bbbbbbbb-1880-4000-8000-000000000001', 'Clube Vista A', 'clube-vista-a'),
  ('bbbbbbbb-1880-4000-8000-000000000002', 'Clube Vista B', 'clube-vista-b');

INSERT INTO app_user (id, clerk_user_id) VALUES
  ('cccccccc-1880-4000-8000-000000000001', 'user_view_owner'),
  ('cccccccc-1880-4000-8000-000000000002', 'user_view_admin'),
  ('cccccccc-1880-4000-8000-000000000003', 'user_view_coach'),
  ('cccccccc-1880-4000-8000-000000000004', 'user_view_family'),
  ('cccccccc-1880-4000-8000-000000000005', 'user_view_other');

INSERT INTO membership (id, organization_id, app_user_id, status) VALUES
  ('dddddddd-1880-4000-8000-000000000001', 'bbbbbbbb-1880-4000-8000-000000000001', 'cccccccc-1880-4000-8000-000000000001', 'active'),
  ('dddddddd-1880-4000-8000-000000000002', 'bbbbbbbb-1880-4000-8000-000000000001', 'cccccccc-1880-4000-8000-000000000002', 'active'),
  ('dddddddd-1880-4000-8000-000000000003', 'bbbbbbbb-1880-4000-8000-000000000001', 'cccccccc-1880-4000-8000-000000000003', 'active'),
  ('dddddddd-1880-4000-8000-000000000004', 'bbbbbbbb-1880-4000-8000-000000000001', 'cccccccc-1880-4000-8000-000000000004', 'active'),
  ('dddddddd-1880-4000-8000-000000000005', 'bbbbbbbb-1880-4000-8000-000000000002', 'cccccccc-1880-4000-8000-000000000005', 'active');

INSERT INTO membership_role (organization_id, membership_id, role) VALUES
  ('bbbbbbbb-1880-4000-8000-000000000001', 'dddddddd-1880-4000-8000-000000000001', 'owner'),
  ('bbbbbbbb-1880-4000-8000-000000000001', 'dddddddd-1880-4000-8000-000000000002', 'admin'),
  ('bbbbbbbb-1880-4000-8000-000000000001', 'dddddddd-1880-4000-8000-000000000003', 'instructor'),
  ('bbbbbbbb-1880-4000-8000-000000000001', 'dddddddd-1880-4000-8000-000000000003', 'admin'),
  ('bbbbbbbb-1880-4000-8000-000000000001', 'dddddddd-1880-4000-8000-000000000004', 'guardian'),
  ('bbbbbbbb-1880-4000-8000-000000000002', 'dddddddd-1880-4000-8000-000000000005', 'owner');

DO $$
DECLARE
  v_org uuid := 'bbbbbbbb-1880-4000-8000-000000000001';
  v_owner uuid := 'dddddddd-1880-4000-8000-000000000001';
  v_admin uuid := 'dddddddd-1880-4000-8000-000000000002';
  v_coach uuid := 'dddddddd-1880-4000-8000-000000000003';
  v_family uuid := 'dddddddd-1880-4000-8000-000000000004';
  v_view uuid; v_roles text[]; v_seen uuid; ok boolean;
BEGIN
  -- Test 1: a person who teaches and administers is viewed as an instructor.
  INSERT INTO app_view (organization_id, viewer_membership_id, viewed_membership_id, hat)
  VALUES (v_org, v_owner, v_coach, 'teaching') RETURNING id INTO v_view;
  SELECT o_view_id, o_viewed_roles INTO v_seen, v_roles
    FROM resolve_memberships('user_view_owner');
  ASSERT v_seen = v_view, 'a live view resolves';
  ASSERT v_roles = ARRAY['instructor'], format('only the home''s roles, got %s', v_roles);
  UPDATE app_view SET ended_at = now() WHERE id = v_view;
  ASSERT (SELECT o_view_id FROM resolve_memberships('user_view_owner')) IS NULL, 'Sair ends it';

  -- Test 2: an Admin viewing a family.
  INSERT INTO app_view (organization_id, viewer_membership_id, viewed_membership_id, hat)
  VALUES (v_org, v_admin, v_family, 'family') RETURNING id INTO v_view;
  ASSERT (SELECT o_view_id FROM resolve_memberships('user_view_admin')) = v_view, 'admin view lives';

  -- The reader is demoted.
  UPDATE membership_role SET archived_at = now()
   WHERE membership_id = v_admin AND role = 'admin';
  ASSERT (SELECT o_view_id FROM resolve_memberships('user_view_admin')) IS NULL, 'a demoted reader';
  UPDATE membership_role SET archived_at = NULL
   WHERE membership_id = v_admin AND role = 'admin';
  ASSERT (SELECT o_view_id FROM resolve_memberships('user_view_admin')) = v_view, 'restored';

  -- The person viewed loses the role.
  UPDATE membership_role SET archived_at = now()
   WHERE membership_id = v_family AND role = 'guardian';
  ASSERT (SELECT o_view_id FROM resolve_memberships('user_view_admin')) IS NULL, 'a role lost';
  UPDATE membership_role SET archived_at = NULL
   WHERE membership_id = v_family AND role = 'guardian';

  -- The person viewed leaves.
  UPDATE membership SET archived_at = now() WHERE id = v_family;
  ASSERT (SELECT o_view_id FROM resolve_memberships('user_view_admin')) IS NULL, 'a departed person';
  UPDATE membership SET archived_at = NULL WHERE id = v_family;

  -- The person viewed becomes the Owner: an Admin may not view the Owner.
  UPDATE membership_role SET archived_at = now() WHERE membership_id = v_owner AND role = 'owner';
  INSERT INTO membership_role (organization_id, membership_id, role) VALUES (v_org, v_family, 'owner');
  ASSERT (SELECT o_view_id FROM resolve_memberships('user_view_admin')) IS NULL, 'an Admin and the Owner';
  DELETE FROM membership_role WHERE membership_id = v_family AND role = 'owner';
  UPDATE membership_role SET archived_at = NULL WHERE membership_id = v_owner AND role = 'owner';

  -- Time.
  UPDATE app_view SET started_at = now() - interval '2 hours', expires_at = now() - interval '1 hour'
   WHERE id = v_view;
  ASSERT (SELECT o_view_id FROM resolve_memberships('user_view_admin')) IS NULL, 'an hour passed';
  UPDATE app_view SET ended_at = now() WHERE id = v_view;

  -- Test 4: an hour is the ceiling.
  ok := false;
  BEGIN
    INSERT INTO app_view (organization_id, viewer_membership_id, viewed_membership_id, hat, expires_at)
    VALUES (v_org, v_owner, v_family, 'family', now() + interval '2 hours');
  EXCEPTION WHEN check_violation THEN ok := true;
  END;
  ASSERT ok, 'more than an hour is refused';

  ok := false;
  BEGIN
    INSERT INTO app_view (organization_id, viewer_membership_id, viewed_membership_id, hat)
    VALUES (v_org, v_owner, v_owner, 'family');
  EXCEPTION WHEN check_violation THEN ok := true;
  END;
  ASSERT ok, 'nobody views themselves';

  -- One open view per reader.
  INSERT INTO app_view (organization_id, viewer_membership_id, viewed_membership_id, hat)
  VALUES (v_org, v_owner, v_family, 'family');
  ok := false;
  BEGIN
    INSERT INTO app_view (organization_id, viewer_membership_id, viewed_membership_id, hat)
    VALUES (v_org, v_owner, v_coach, 'teaching');
  EXCEPTION WHEN unique_violation THEN ok := true;
  END;
  ASSERT ok, 'one open view per reader';

  -- Test 5: a composite key refuses another club's person.
  ok := false;
  BEGIN
    INSERT INTO app_view (organization_id, viewer_membership_id, viewed_membership_id, hat)
    VALUES (v_org, v_admin, 'dddddddd-1880-4000-8000-000000000005', 'family');
  EXCEPTION WHEN foreign_key_violation THEN ok := true;
  END;
  ASSERT ok, 'a person of another club is refused by the key';
END $$;

-- Test 3: a view belongs to its support grant.
DO $$
DECLARE
  v_org uuid := 'bbbbbbbb-1880-4000-8000-000000000001';
  v_support uuid := 'dddddddd-1880-4000-8000-000000000009';
  v_first uuid; v_second uuid; v_view uuid; ok boolean;
BEGIN
  INSERT INTO platform_admin (clerk_user_id, note) VALUES ('user_view_support', 'Teste');
  INSERT INTO app_user (id, clerk_user_id)
  VALUES ('cccccccc-1880-4000-8000-000000000009', 'user_view_support');

  INSERT INTO support_grant (organization_id, source, granted_by_membership_id, starts_at, expires_at)
  VALUES (v_org, 'owner', 'dddddddd-1880-4000-8000-000000000001', now() - interval '5 minutes', now() + interval '1 hour')
  RETURNING id INTO v_first;
  INSERT INTO support_grant (organization_id, source, granted_by_membership_id, starts_at, expires_at)
  VALUES (v_org, 'owner', 'dddddddd-1880-4000-8000-000000000001', now() - interval '5 minutes', now() + interval '1 hour')
  RETURNING id INTO v_second;
  INSERT INTO membership (id, organization_id, app_user_id, status, support_grant_id)
  VALUES (v_support, v_org, 'cccccccc-1880-4000-8000-000000000009', 'active', v_first);

  -- Support says why.
  ok := false;
  BEGIN
    INSERT INTO app_view (organization_id, viewer_membership_id, viewed_membership_id, hat, viewer_support_grant_id)
    VALUES (v_org, v_support, 'dddddddd-1880-4000-8000-000000000004', 'family', v_first);
  EXCEPTION WHEN check_violation THEN ok := true;
  END;
  ASSERT ok, 'a support view needs a reason';

  INSERT INTO app_view (organization_id, viewer_membership_id, viewed_membership_id, hat, viewer_support_grant_id, reason)
  VALUES (v_org, v_support, 'dddddddd-1880-4000-8000-000000000004', 'family', v_first, 'Avaria na agenda')
  RETURNING id INTO v_view;
  ASSERT (SELECT o_view_id FROM resolve_memberships('user_view_support')) = v_view, 'support view lives';

  -- The same membership under a new grant: the old view does not come back.
  UPDATE membership SET support_grant_id = v_second WHERE id = v_support;
  ASSERT (SELECT o_view_id FROM resolve_memberships('user_view_support')) IS NULL, 'a new grant is a new session';

  -- Support may not view the Owner.
  UPDATE app_view SET ended_at = now() WHERE id = v_view;
  INSERT INTO membership_role (organization_id, membership_id, role)
  VALUES (v_org, 'dddddddd-1880-4000-8000-000000000001', 'guardian');
  INSERT INTO app_view (organization_id, viewer_membership_id, viewed_membership_id, hat, viewer_support_grant_id, reason)
  VALUES (v_org, v_support, 'dddddddd-1880-4000-8000-000000000001', 'family', v_second, 'Teste')
  RETURNING id INTO v_view;
  ASSERT (SELECT o_view_id FROM resolve_memberships('user_view_support')) IS NULL, 'support and the Owner';
END $$;

-- Test 4 and 5, as the app.
SELECT set_config('app.organization_id', 'bbbbbbbb-1880-4000-8000-000000000002', true);
SET LOCAL ROLE poolse_app;

DO $$
DECLARE ok boolean; v_rows integer;
BEGIN
  ASSERT (SELECT count(*) FROM app_view) = 0, 'another club reads nothing';

  ok := false;
  BEGIN
    INSERT INTO app_view (organization_id, viewer_membership_id, viewed_membership_id, hat)
    VALUES ('bbbbbbbb-1880-4000-8000-000000000001',
            'dddddddd-1880-4000-8000-000000000001',
            'dddddddd-1880-4000-8000-000000000004', 'family');
  EXCEPTION WHEN insufficient_privilege THEN ok := true;
  END;
  ASSERT ok, 'another club writes nothing';
END $$;

SELECT set_config('app.organization_id', 'bbbbbbbb-1880-4000-8000-000000000001', true);

DO $$
DECLARE ok boolean;
BEGIN
  ASSERT (SELECT count(*) FROM app_view) > 0, 'the club reads its own';

  ok := false;
  BEGIN
    UPDATE app_view SET viewed_membership_id = 'dddddddd-1880-4000-8000-000000000003';
  EXCEPTION WHEN insufficient_privilege THEN ok := true;
  END;
  ASSERT ok, 'who was viewed cannot be rewritten';

  ok := false;
  BEGIN
    UPDATE app_view SET expires_at = now() + interval '1 hour';
  EXCEPTION WHEN insufficient_privilege THEN ok := true;
  END;
  ASSERT ok, 'an hour cannot be extended';

  ok := false;
  BEGIN
    DELETE FROM app_view;
  EXCEPTION WHEN insufficient_privilege THEN ok := true;
  END;
  ASSERT ok, 'the record cannot be deleted';
END $$;

RESET ROLE;
ROLLBACK;
