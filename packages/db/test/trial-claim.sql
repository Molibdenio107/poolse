-- One person, one trial, proved at the database — POOLSE-62.
--
-- Four properties, and the first is the whole feature:
--
--   1. **One live claim per normalised address.** The unique index is the block;
--      the API does not ask first, because a question asked before a write is a
--      question whose answer can change before the write lands.
--   2. **Normalisation has one definition**, in SQL, shared by the ledger and by
--      anything that ever needs to ask again.
--   3. **A release frees the address, and is a row rather than a deletion.**
--      Both unique indexes are partial on `released_at`, which is what makes
--      *conceder novo período* work at all.
--   4. **A claim outlives its organization**, archiving included. Releasing one
--      on archive would be the abuse path with extra steps.
--
-- Run: pnpm db:test

\set ON_ERROR_STOP on
BEGIN;

INSERT INTO organization (id, name, slug) VALUES
  ('aaaa1111-bbbb-2222-cccc-333333333333', 'Clube Um', 'clube-um'),
  ('dddd4444-eeee-5555-ffff-666666666666', 'Clube Dois', 'clube-dois');

-- ---------------------------------------------------------------------------
-- Test 1 — the same address, spelled differently, is the same address
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF normalize_signup_email('Rui.Fonseca+poolse@GMail.com') <> 'ruifonseca@gmail.com' THEN
    RAISE EXCEPTION 'FAIL test 1a: gmail dots and +tags survived normalisation (%)',
      normalize_signup_email('Rui.Fonseca+poolse@GMail.com');
  END IF;

  -- Googlemail is the same mailbox spelled another way.
  IF normalize_signup_email('rui.fonseca@googlemail.com') <> 'ruifonseca@gmail.com' THEN
    RAISE EXCEPTION 'FAIL test 1b: googlemail is not folded into gmail';
  END IF;

  /*
   * And dots are kept everywhere else, deliberately: on gmail they are ignored,
   * and on every other provider `j.silva@` and `jsilva@` are two people.
   */
  IF normalize_signup_email('J.Silva+x@outlook.com') <> 'j.silva@outlook.com' THEN
    RAISE EXCEPTION 'FAIL test 1c: a non-gmail address lost its dots';
  END IF;

  IF normalize_signup_email('not-an-email') IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL test 1d: something without a domain normalised to a value';
  END IF;

  RAISE NOTICE 'PASS test 1: one definition of what counts as the same address';
END $$;

-- ---------------------------------------------------------------------------
-- Test 2 — one live claim per address, and the index is what says so
-- ---------------------------------------------------------------------------

DO $$
DECLARE ok boolean;
BEGIN
  INSERT INTO trial_claim (organization_id, normalized_email, email_domain)
  VALUES ('aaaa1111-bbbb-2222-cccc-333333333333', 'ruifonseca@gmail.com', 'gmail.com');

  ok := false;
  BEGIN
    INSERT INTO trial_claim (organization_id, normalized_email, email_domain)
    VALUES ('dddd4444-eeee-5555-ffff-666666666666', 'ruifonseca@gmail.com', 'gmail.com');
  EXCEPTION WHEN unique_violation THEN ok := true;
  END;
  IF NOT ok THEN
    RAISE EXCEPTION 'FAIL test 2a: one address started two trials';
  END IF;

  -- A different address is nobody's business but its own.
  INSERT INTO trial_claim (organization_id, normalized_email, email_domain)
  VALUES ('dddd4444-eeee-5555-ffff-666666666666', 'outro@clube.pt', 'clube.pt');

  RAISE NOTICE 'PASS test 2: a repeated address is refused by the index, not by a check';
END $$;

-- ---------------------------------------------------------------------------
-- Test 3 — releasing frees the address, and leaves the history
-- ---------------------------------------------------------------------------

DO $$
DECLARE v_released int; ok boolean;
BEGIN
  UPDATE trial_claim
     SET released_at = now(), released_by_clerk_user_id = 'user_operator'
   WHERE normalized_email = 'ruifonseca@gmail.com';

  -- The same person may now start again, which is the point of the override.
  INSERT INTO trial_claim (organization_id, normalized_email, email_domain)
  VALUES ('dddd4444-eeee-5555-ffff-666666666666', 'ruifonseca@gmail.com', 'gmail.com');

  -- And the first claim is still there: a release is a row, not a deletion.
  SELECT count(*) INTO v_released FROM trial_claim
   WHERE normalized_email = 'ruifonseca@gmail.com';
  IF v_released <> 2 THEN
    RAISE EXCEPTION 'FAIL test 3a: expected the old claim to survive, found % row(s)', v_released;
  END IF;

  -- A release without an author is not a release.
  ok := false;
  BEGIN
    UPDATE trial_claim SET released_at = now(), released_by_clerk_user_id = NULL
     WHERE normalized_email = 'outro@clube.pt';
  EXCEPTION WHEN check_violation THEN ok := true;
  END;
  IF NOT ok THEN
    RAISE EXCEPTION 'FAIL test 3b: an address was freed by nobody';
  END IF;

  RAISE NOTICE 'PASS test 3: a release frees the address and keeps the record';
END $$;

-- ---------------------------------------------------------------------------
-- Test 4 — a claim outlives the club that made it
-- ---------------------------------------------------------------------------
--
-- Archiving is what the trial clock does on day 75. If that freed the address,
-- the abuse path would be "let it lapse, wait, start again" — which is the
-- behaviour this whole ledger exists to refuse.

DO $$
DECLARE ok boolean;
BEGIN
  UPDATE organization SET archived_at = now()
   WHERE id = 'dddd4444-eeee-5555-ffff-666666666666';

  ok := false;
  BEGIN
    INSERT INTO trial_claim (organization_id, normalized_email, email_domain)
    VALUES ('aaaa1111-bbbb-2222-cccc-333333333333', 'outro@clube.pt', 'clube.pt');
  EXCEPTION WHEN unique_violation THEN ok := true;
  END;
  IF NOT ok THEN
    RAISE EXCEPTION 'FAIL test 4: archiving a club freed its address';
  END IF;

  RAISE NOTICE 'PASS test 4: a claim survives the archiving of its organization';
END $$;

-- ---------------------------------------------------------------------------
-- Test 5 — the ledger is the platform's alone
-- ---------------------------------------------------------------------------
--
-- A club must not be able to read who else has signed up, nor write itself a
-- release. Two independent reasons say so — no grant, and no policy naming
-- `poolse_app` — and both are asserted, because `ALTER DEFAULT PRIVILEGES` hands
-- the tenant login all four verbs on every new table.

SET LOCAL ROLE poolse_app;
SELECT set_config('app.organization_id', 'aaaa1111-bbbb-2222-cccc-333333333333', true);

DO $$
DECLARE ok boolean; v_seen int;
BEGIN
  ok := false;
  BEGIN
    SELECT count(*) INTO v_seen FROM trial_claim;
  EXCEPTION WHEN insufficient_privilege THEN ok := true;
  END;
  IF NOT ok THEN
    RAISE EXCEPTION 'FAIL test 5a: a tenant read the trial ledger (% rows)', v_seen;
  END IF;

  ok := false;
  BEGIN
    UPDATE trial_claim SET released_at = now(), released_by_clerk_user_id = 'user_self';
  EXCEPTION WHEN insufficient_privilege THEN ok := true;
  END;
  IF NOT ok THEN
    RAISE EXCEPTION 'FAIL test 5b: a tenant freed its own address';
  END IF;

  RAISE NOTICE 'PASS test 5: the ledger is invisible and unwritable from a club';
END $$;

RESET ROLE;

-- ---------------------------------------------------------------------------
-- Test 6 — the operator may read it and release, and nothing more
-- ---------------------------------------------------------------------------

SET LOCAL ROLE poolse_platform;

DO $$
DECLARE ok boolean; v_seen int;
BEGIN
  SELECT count(*) INTO v_seen FROM trial_claim;
  IF v_seen < 2 THEN
    RAISE EXCEPTION 'FAIL test 6a: the operator cannot see the ledger';
  END IF;

  UPDATE trial_claim
     SET released_at = now(), released_by_clerk_user_id = 'user_operator'
   WHERE normalized_email = 'outro@clube.pt';

  -- No DELETE: the ledger is a book, like every other in this schema.
  ok := false;
  BEGIN
    DELETE FROM trial_claim WHERE normalized_email = 'outro@clube.pt';
  EXCEPTION WHEN insufficient_privilege THEN ok := true;
  END;
  IF NOT ok THEN
    RAISE EXCEPTION 'FAIL test 6b: a claim was deleted rather than released';
  END IF;

  RAISE NOTICE 'PASS test 6: the operator releases a claim and cannot destroy one';
END $$;

RESET ROLE;

ROLLBACK;
