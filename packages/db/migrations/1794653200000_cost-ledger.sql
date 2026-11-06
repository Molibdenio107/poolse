-- Up Migration

-- POOLSE-182 — one cost ledger (Rui, 05-11-2026: "the average costs of
-- everything together but separated at the same time per civil year and per
-- season"). Every euro is an amount with a period, spread by day into months;
-- a civil year and an época are two windows over the same month rows, so they
-- can never disagree.
--
-- **What is recorded here**: water, maintenance services (on an avaria or a
-- task completion), fixed costs (one-off or recurring) — `cost_entry`;
-- materials — `inventory_purchase`; the insurance premium — two columns on
-- `insurance_policy`.
--
-- **What is read through, never copied**: energy bills (allocated from
-- `energy_invoice` by trigger, so editing a bill re-allocates it), salary
-- accruals (`salary_months()`, computed from `staff_compensation` on read), and
-- tariff estimates (the API, with the energy module's own pricing).
--
-- **`cost_month` is derived.** Triggers keep it; nothing else writes it. A row
-- is a source's share of one month, net and VAT apart, with its kind and its
-- basis: `invoice` (a document exists) or `estimate`.
--
-- **Allocation is by day** (`allocate_cost`): a share is the amount times the
-- days of the period inside the month over the days of the period. Rounding is
-- carried forward, so the shares are never negative and always sum to the
-- amount exactly; what is left over lands in the last month.

CREATE TYPE cost_kind AS ENUM
  ('electricity', 'gas', 'water', 'maintenance_service', 'materials', 'insurance', 'salary', 'fixed', 'other');
CREATE TYPE cost_basis AS ENUM ('invoice', 'estimate');
CREATE TYPE cost_recurrence AS ENUM ('none', 'monthly', 'yearly');

-- ---------------------------------------------------------------- allocation
CREATE FUNCTION allocate_cost(p_from date, p_to date, p_cents bigint)
RETURNS TABLE (month date, cents bigint)
LANGUAGE sql IMMUTABLE STRICT
AS $$
  WITH span AS (
    SELECT (p_to - p_from + 1)::numeric AS days
  ),
  months AS (
    SELECT m::date AS month,
           (least(p_to, (m + interval '1 month - 1 day')::date)
              - greatest(p_from, m::date) + 1) AS overlap
      FROM generate_series(date_trunc('month', p_from), date_trunc('month', p_to), interval '1 month') AS m
  ),
  running AS (
    SELECT month,
           round(p_cents * sum(overlap) OVER (ORDER BY month) / (SELECT days FROM span)) AS upto
      FROM months
  )
  SELECT month, (upto - coalesce(lag(upto) OVER (ORDER BY month), 0))::bigint
    FROM running
   WHERE p_from <= p_to
   ORDER BY month
$$;

COMMENT ON FUNCTION allocate_cost(date, date, bigint) IS
  'POOLSE-182: an amount over an inclusive date period, as one share per calendar month, by day. '
  'Rounding carried forward: shares are never negative and sum exactly to the amount.';

-- ------------------------------------------------------------ what is recorded
CREATE TABLE cost_entry (
  id                         uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id            uuid NOT NULL REFERENCES organization (id),
  -- Null is the club as a whole (the Poolse subscription, an accountant).
  facility_id                uuid,
  kind                       cost_kind NOT NULL,
  basis                      cost_basis NOT NULL DEFAULT 'invoice',
  amount_cents               integer NOT NULL,
  vat_cents                  integer NOT NULL DEFAULT 0,
  -- A one-off or an occurrence has a period; a recurring template has effective dates.
  period_from                date,
  period_to                  date,
  recurrence                 cost_recurrence NOT NULL DEFAULT 'none',
  effective_from             date,
  effective_to               date,
  -- The template an occurrence was generated from.
  template_id                uuid,
  supplier                   text,
  document_number            text,
  file_id                    uuid,
  -- What a maintenance service was for: an avaria, or a task done.
  maintenance_request_id     uuid,
  task_completion_id         uuid,
  note                       text,
  recorded_by                uuid,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  updated_at                 timestamptz NOT NULL DEFAULT now(),
  archived_at                timestamptz,
  PRIMARY KEY (id),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, facility_id) REFERENCES facility (organization_id, id),
  FOREIGN KEY (organization_id, file_id) REFERENCES stored_file (organization_id, id),
  FOREIGN KEY (organization_id, recorded_by) REFERENCES membership (organization_id, id),
  FOREIGN KEY (organization_id, template_id) REFERENCES cost_entry (organization_id, id),
  FOREIGN KEY (organization_id, maintenance_request_id) REFERENCES maintenance_request (organization_id, id),
  FOREIGN KEY (organization_id, task_completion_id) REFERENCES maintenance_task_completion (organization_id, id),
  -- Energy and salaries are read through; materials and insurance have their own homes.
  CONSTRAINT cost_entry_kind CHECK (kind IN ('water', 'maintenance_service', 'fixed', 'other')),
  CONSTRAINT cost_entry_amounts CHECK (amount_cents >= 0 AND vat_cents >= 0),
  CONSTRAINT cost_entry_shape CHECK (
    CASE WHEN recurrence = 'none'
         THEN period_from IS NOT NULL AND period_to IS NOT NULL AND period_from <= period_to
              AND effective_from IS NULL AND effective_to IS NULL
         ELSE period_from IS NULL AND period_to IS NULL AND template_id IS NULL
              AND effective_from IS NOT NULL AND (effective_to IS NULL OR effective_to >= effective_from)
    END),
  CONSTRAINT cost_entry_one_source CHECK (num_nonnulls(maintenance_request_id, task_completion_id) <= 1),
  CONSTRAINT cost_entry_source_is_service CHECK (
    num_nonnulls(maintenance_request_id, task_completion_id) = 0 OR kind = 'maintenance_service'),
  CONSTRAINT cost_entry_note CHECK (note IS NULL OR length(note) <= 500)
);

COMMENT ON TABLE cost_entry IS
  'POOLSE-182: a cost the club records — water, a maintenance service, a fixed cost. Net amount and VAT '
  'apart. A recurring template generates occurrences (materialise_fixed_costs); an occurrence the club '
  'did not pay is archived, never deleted, so it is not generated again.';

-- An occurrence is generated once per template and period, archived or not.
CREATE UNIQUE INDEX cost_entry_occurrence ON cost_entry (organization_id, template_id, period_from)
  WHERE template_id IS NOT NULL;
CREATE INDEX cost_entry_period_idx ON cost_entry (organization_id, period_from) WHERE archived_at IS NULL;

CREATE TRIGGER cost_entry_updated_at BEFORE UPDATE ON cost_entry
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
ALTER TABLE cost_entry ENABLE ROW LEVEL SECURITY;
CREATE POLICY cost_entry_tenant ON cost_entry
  USING (organization_id = current_organization_id())
  WITH CHECK (organization_id = current_organization_id());

CREATE TABLE inventory_purchase (
  id                 uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id    uuid NOT NULL REFERENCES organization (id),
  inventory_item_id  uuid NOT NULL,
  quantity           integer NOT NULL,
  amount_cents       integer NOT NULL,
  vat_cents          integer NOT NULL DEFAULT 0,
  bought_on          date NOT NULL,
  supplier           text,
  document_number    text,
  file_id            uuid,
  recorded_by        uuid,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  archived_at        timestamptz,
  PRIMARY KEY (id),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, inventory_item_id) REFERENCES inventory_item (organization_id, id),
  FOREIGN KEY (organization_id, file_id) REFERENCES stored_file (organization_id, id),
  FOREIGN KEY (organization_id, recorded_by) REFERENCES membership (organization_id, id),
  CONSTRAINT inventory_purchase_quantity CHECK (quantity > 0),
  CONSTRAINT inventory_purchase_amounts CHECK (amount_cents >= 0 AND vat_cents >= 0)
);

COMMENT ON TABLE inventory_purchase IS
  'POOLSE-182: materials bought — the cost of stock. Recording one raises inventory_item.quantity in the '
  'same transaction (the API); consumption stays a quantity and is never priced.';

CREATE INDEX inventory_purchase_item_idx ON inventory_purchase (organization_id, inventory_item_id, bought_on DESC);
CREATE TRIGGER inventory_purchase_updated_at BEFORE UPDATE ON inventory_purchase
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
ALTER TABLE inventory_purchase ENABLE ROW LEVEL SECURITY;
CREATE POLICY inventory_purchase_tenant ON inventory_purchase
  USING (organization_id = current_organization_id())
  WITH CHECK (organization_id = current_organization_id());

-- The last purchase's unit cost, as information: never used to price consumption.
ALTER TABLE inventory_item ADD COLUMN unit_cost_cents integer
  CONSTRAINT inventory_item_unit_cost CHECK (unit_cost_cents IS NULL OR unit_cost_cents >= 0);

-- The premium (rule 6). `cost_per_person_cents` is a different fact and stays.
ALTER TABLE insurance_policy
  ADD COLUMN premium_cents integer,
  ADD COLUMN premium_vat_cents integer,
  ADD CONSTRAINT insurance_policy_premium CHECK (
    (premium_cents IS NULL AND premium_vat_cents IS NULL)
    OR (premium_cents >= 0 AND coalesce(premium_vat_cents, 0) >= 0 AND valid_to IS NOT NULL));

-- -------------------------------------------------------------- the month rows
CREATE TABLE cost_month (
  organization_id uuid NOT NULL REFERENCES organization (id),
  source_kind     text NOT NULL,
  source_id       uuid NOT NULL,
  month           date NOT NULL,
  share_cents     bigint NOT NULL,
  vat_cents       bigint NOT NULL,
  kind            cost_kind NOT NULL,
  basis           cost_basis NOT NULL,
  facility_id     uuid,
  PRIMARY KEY (organization_id, source_kind, source_id, month),
  FOREIGN KEY (organization_id, facility_id) REFERENCES facility (organization_id, id),
  CONSTRAINT cost_month_source CHECK (source_kind IN ('cost_entry', 'inventory_purchase', 'insurance_policy', 'energy_invoice')),
  CONSTRAINT cost_month_first_day CHECK (month = date_trunc('month', month)::date)
);

COMMENT ON TABLE cost_month IS
  'POOLSE-182: derived — one source''s share of one month. Kept by triggers on its sources; never written '
  'by the app, never on read.';

CREATE INDEX cost_month_month_idx ON cost_month (organization_id, month);
ALTER TABLE cost_month ENABLE ROW LEVEL SECURITY;
CREATE POLICY cost_month_tenant ON cost_month
  USING (organization_id = current_organization_id())
  WITH CHECK (organization_id = current_organization_id());

-- The app reads the months; the triggers (running as the app) keep them.
REVOKE ALL ON cost_month FROM poolse_app;
GRANT SELECT, INSERT, DELETE ON cost_month TO poolse_app;

/*
 * One source's months, replaced whole. The VAT is spread on the same days as
 * the net amount, independently rounded, so each column sums exactly.
 */
CREATE FUNCTION cost_month_replace(
  p_org uuid, p_source text, p_id uuid, p_live boolean,
  p_from date, p_to date, p_net bigint, p_vat bigint,
  p_kind cost_kind, p_basis cost_basis, p_facility uuid)
RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM cost_month WHERE organization_id = p_org AND source_kind = p_source AND source_id = p_id;
  IF NOT p_live OR p_from IS NULL OR p_to IS NULL OR p_from > p_to THEN
    RETURN;
  END IF;
  INSERT INTO cost_month (organization_id, source_kind, source_id, month, share_cents, vat_cents, kind, basis, facility_id)
  SELECT p_org, p_source, p_id, n.month, n.cents, v.cents, p_kind, p_basis, p_facility
    FROM allocate_cost(p_from, p_to, p_net) n
    JOIN allocate_cost(p_from, p_to, p_vat) v ON v.month = n.month;
END;
$$;

CREATE FUNCTION cost_entry_allocates() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE r cost_entry;
BEGIN
  IF TG_OP = 'DELETE' THEN r := OLD; ELSE r := NEW; END IF;
  PERFORM public.cost_month_replace(r.organization_id, 'cost_entry', r.id,
    TG_OP <> 'DELETE' AND r.archived_at IS NULL AND r.recurrence = 'none',
    r.period_from, r.period_to, r.amount_cents, r.vat_cents, r.kind, r.basis, r.facility_id);
  RETURN NULL;
END;
$$;
CREATE TRIGGER cost_entry_allocates AFTER INSERT OR UPDATE OR DELETE ON cost_entry
  FOR EACH ROW EXECUTE FUNCTION cost_entry_allocates();

CREATE FUNCTION inventory_purchase_allocates() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE r inventory_purchase; v_facility uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN r := OLD; ELSE r := NEW; END IF;
  SELECT facility_id INTO v_facility FROM inventory_item
   WHERE organization_id = r.organization_id AND id = r.inventory_item_id;
  PERFORM public.cost_month_replace(r.organization_id, 'inventory_purchase', r.id,
    TG_OP <> 'DELETE' AND r.archived_at IS NULL,
    r.bought_on, r.bought_on, r.amount_cents, r.vat_cents, 'materials', 'invoice', v_facility);
  RETURN NULL;
END;
$$;
CREATE TRIGGER inventory_purchase_allocates AFTER INSERT OR UPDATE OR DELETE ON inventory_purchase
  FOR EACH ROW EXECUTE FUNCTION inventory_purchase_allocates();

CREATE FUNCTION insurance_premium_allocates() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE r insurance_policy;
BEGIN
  IF TG_OP = 'DELETE' THEN r := OLD; ELSE r := NEW; END IF;
  PERFORM public.cost_month_replace(r.organization_id, 'insurance_policy', r.id,
    TG_OP <> 'DELETE' AND r.archived_at IS NULL AND r.premium_cents IS NOT NULL,
    r.valid_from, r.valid_to, coalesce(r.premium_cents, 0), coalesce(r.premium_vat_cents, 0),
    'insurance', 'invoice', r.facility_id);
  RETURN NULL;
END;
$$;
CREATE TRIGGER insurance_premium_allocates AFTER INSERT OR UPDATE OR DELETE ON insurance_policy
  FOR EACH ROW EXECUTE FUNCTION insurance_premium_allocates();

-- A bill: on its header period (the energy 5.3 trap), net = total − VAT, its
-- kind by the meter's carrier, its site by the meter's.
CREATE FUNCTION energy_invoice_allocates() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE r energy_invoice; v_carrier text; v_facility uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN r := OLD; ELSE r := NEW; END IF;
  SELECT m.carrier::text, m.facility_id INTO v_carrier, v_facility FROM energy_meter m
   WHERE m.organization_id = r.organization_id AND m.id = r.meter_id;
  PERFORM public.cost_month_replace(r.organization_id, 'energy_invoice', r.id,
    TG_OP <> 'DELETE' AND r.archived_at IS NULL,
    r.period_start, r.period_end, r.total_cents - r.vat_cents, r.vat_cents,
    coalesce(v_carrier, 'electricity')::cost_kind, 'invoice', v_facility);
  RETURN NULL;
END;
$$;
CREATE TRIGGER energy_invoice_allocates AFTER INSERT OR UPDATE OR DELETE ON energy_invoice
  FOR EACH ROW EXECUTE FUNCTION energy_invoice_allocates();

-- The bills already filed, allocated once.
INSERT INTO cost_month (organization_id, source_kind, source_id, month, share_cents, vat_cents, kind, basis, facility_id)
SELECT i.organization_id, 'energy_invoice', i.id, n.month, n.cents, v.cents,
       coalesce(m.carrier::text, 'electricity')::cost_kind, 'invoice', m.facility_id
  FROM energy_invoice i
  JOIN energy_meter m ON m.organization_id = i.organization_id AND m.id = i.meter_id
  CROSS JOIN LATERAL allocate_cost(i.period_start, i.period_end, (i.total_cents - i.vat_cents)::bigint) n
  JOIN LATERAL allocate_cost(i.period_start, i.period_end, i.vat_cents::bigint) v ON v.month = n.month
 WHERE i.archived_at IS NULL AND i.period_start <= i.period_end;

-- ------------------------------------------------------- recurring fixed costs
/*
 * Generates a club's recurring occurrences up to `p_until`, idempotently. An
 * occurrence archived as *não pago* is not generated again: the unique index
 * counts archived rows on purpose.
 */
CREATE FUNCTION materialise_fixed_costs(p_until date)
RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE v_count integer;
BEGIN
  WITH templates AS (
    SELECT * FROM cost_entry
     WHERE organization_id = current_organization_id()
       AND recurrence <> 'none' AND archived_at IS NULL
  ), starts AS (
    SELECT t.*, s::date AS starts_on,
           CASE t.recurrence WHEN 'monthly' THEN interval '1 month' ELSE interval '1 year' END AS step
      FROM templates t
      CROSS JOIN LATERAL generate_series(
        t.effective_from,
        least(coalesce(t.effective_to, p_until), p_until),
        CASE t.recurrence WHEN 'monthly' THEN interval '1 month' ELSE interval '1 year' END) AS s
  ), inserted AS (
    INSERT INTO cost_entry (organization_id, facility_id, kind, basis, amount_cents, vat_cents,
                            period_from, period_to, template_id, supplier, note, recorded_by)
    SELECT organization_id, facility_id, kind, basis, amount_cents, vat_cents,
           starts_on,
           least((starts_on + step - interval '1 day')::date, coalesce(effective_to, 'infinity'::date)),
           id, supplier, note, recorded_by
      FROM starts
    ON CONFLICT DO NOTHING
    RETURNING 1
  )
  SELECT count(*)::int INTO v_count FROM inserted;
  RETURN v_count;
END;
$$;

-- ------------------------------------------------------------------- salaries
/*
 * What staff pay accrues per month in a window — an estimate, read on demand.
 * Monthly pay: amount × pay periods (12 or 14) / 12. Hourly: amount × weekly
 * hours × 52 / 12, and a rate with no hours is left out and counted, so the
 * screen can say so. A month a rate covers partly takes its days' share.
 * `p_without_owner`: an Admin's total never includes the Owner's pay.
 */
CREATE FUNCTION salary_months(p_from date, p_to date, p_without_owner boolean)
RETURNS TABLE (month date, cents bigint, people integer, without_hours integer)
LANGUAGE sql STABLE AS $$
  WITH months AS (
    SELECT m::date AS month, (m + interval '1 month - 1 day')::date AS month_end
      FROM generate_series(date_trunc('month', p_from), date_trunc('month', p_to), interval '1 month') AS m
  ), rates AS (
    SELECT c.*,
           CASE c.kind
             WHEN 'monthly' THEN c.amount_cents::numeric * c.pay_periods_per_year / 12
             WHEN 'hourly'  THEN c.amount_cents::numeric * c.weekly_hours * 52 / 12
           END AS per_month
      FROM staff_compensation c
     WHERE c.organization_id = current_organization_id()
       AND c.archived_at IS NULL
       AND NOT (p_without_owner AND EXISTS (
             SELECT 1 FROM membership_role r
              WHERE r.organization_id = c.organization_id AND r.membership_id = c.staff_membership_id
                AND r.role = 'owner' AND r.archived_at IS NULL))
  )
  SELECT months.month,
         coalesce(round(sum(r.per_month
           * (least(months.month_end, coalesce(r.effective_to, months.month_end))
              - greatest(months.month, r.effective_from) + 1)
           / (months.month_end - months.month + 1))), 0)::bigint,
         count(DISTINCT r.staff_membership_id) FILTER (WHERE r.per_month IS NOT NULL)::int,
         count(DISTINCT r.staff_membership_id) FILTER (WHERE r.per_month IS NULL)::int
    FROM months
    LEFT JOIN rates r
      ON r.effective_from <= months.month_end
     AND (r.effective_to IS NULL OR r.effective_to >= months.month)
   GROUP BY months.month
   ORDER BY months.month
$$;

-- -------------------------------------------------------------------- windows
/*
 * A window over the month rows — rule 3. A month the window covers partly
 * counts its days' share, by the same rule as allocation. Rounded per kind and
 * basis at the end, never per month, so a year read in pieces adds up.
 */
CREATE FUNCTION cost_window(p_from date, p_to date)
RETURNS TABLE (kind cost_kind, basis cost_basis, facility_id uuid, net_cents bigint, vat_cents bigint)
LANGUAGE sql STABLE AS $$
  SELECT cm.kind, cm.basis, cm.facility_id,
         round(sum(cm.share_cents * f.part))::bigint,
         round(sum(cm.vat_cents * f.part))::bigint
    FROM cost_month cm
    CROSS JOIN LATERAL (
      SELECT (least(p_to, (cm.month + interval '1 month - 1 day')::date) - greatest(p_from, cm.month) + 1)::numeric
             / ((cm.month + interval '1 month')::date - cm.month) AS part
    ) f
   WHERE cm.organization_id = current_organization_id()
     AND cm.month >= date_trunc('month', p_from)::date
     AND cm.month <= p_to
     AND f.part > 0
   GROUP BY cm.kind, cm.basis, cm.facility_id
$$;

-- Down Migration

DROP FUNCTION IF EXISTS cost_window(date, date);
DROP FUNCTION IF EXISTS salary_months(date, date, boolean);
DROP FUNCTION IF EXISTS materialise_fixed_costs(date);
DROP TRIGGER IF EXISTS energy_invoice_allocates ON energy_invoice;
DROP FUNCTION IF EXISTS energy_invoice_allocates();
DROP TRIGGER IF EXISTS insurance_premium_allocates ON insurance_policy;
DROP FUNCTION IF EXISTS insurance_premium_allocates();
DROP TRIGGER IF EXISTS inventory_purchase_allocates ON inventory_purchase;
DROP FUNCTION IF EXISTS inventory_purchase_allocates();
DROP TRIGGER IF EXISTS cost_entry_allocates ON cost_entry;
DROP FUNCTION IF EXISTS cost_entry_allocates();
DROP FUNCTION IF EXISTS cost_month_replace(uuid, text, uuid, boolean, date, date, bigint, bigint, cost_kind, cost_basis, uuid);
DROP TABLE IF EXISTS cost_month;
ALTER TABLE insurance_policy
  DROP CONSTRAINT IF EXISTS insurance_policy_premium,
  DROP COLUMN IF EXISTS premium_vat_cents,
  DROP COLUMN IF EXISTS premium_cents;
ALTER TABLE inventory_item DROP COLUMN IF EXISTS unit_cost_cents;
DROP TABLE IF EXISTS inventory_purchase;
DROP TABLE IF EXISTS cost_entry;
DROP FUNCTION IF EXISTS allocate_cost(date, date, bigint);
DROP TYPE IF EXISTS cost_recurrence;
DROP TYPE IF EXISTS cost_basis;
DROP TYPE IF EXISTS cost_kind;
