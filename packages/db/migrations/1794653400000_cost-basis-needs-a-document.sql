-- Up Migration

/*
 * *Faturado* means a document exists (Rui, 06-11-2026). POOLSE-182 defaulted a
 * typed cost to `invoice` and wrote `invoice` for every purchase, so a figure
 * somebody typed from memory read the same as a bill.
 *
 * A purchase's basis now follows its document number, in the trigger that
 * allocates it. A recorded cost's basis is chosen by the API when it is inserted.
 * Existing rows follow the same rule; the update fires each row's own trigger, so
 * `cost_month` is re-allocated and nothing is copied by hand.
 *
 * A policy's premium stays `invoice`: the policy is the document.
 */

CREATE OR REPLACE FUNCTION inventory_purchase_allocates() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE r inventory_purchase; v_facility uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN r := OLD; ELSE r := NEW; END IF;
  SELECT facility_id INTO v_facility FROM inventory_item
   WHERE organization_id = r.organization_id AND id = r.inventory_item_id;
  PERFORM public.cost_month_replace(r.organization_id, 'inventory_purchase', r.id,
    TG_OP <> 'DELETE' AND r.archived_at IS NULL,
    r.bought_on, r.bought_on, r.amount_cents, r.vat_cents, 'materials',
    (CASE WHEN r.document_number IS NULL THEN 'estimate' ELSE 'invoice' END)::cost_basis,
    v_facility);
  RETURN NULL;
END;
$$;

UPDATE cost_entry SET basis = 'estimate'
 WHERE basis = 'invoice' AND document_number IS NULL AND file_id IS NULL;

UPDATE inventory_purchase SET updated_at = updated_at WHERE document_number IS NULL;

-- Down Migration

CREATE OR REPLACE FUNCTION inventory_purchase_allocates() RETURNS trigger
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

UPDATE inventory_purchase SET updated_at = updated_at WHERE document_number IS NULL;
