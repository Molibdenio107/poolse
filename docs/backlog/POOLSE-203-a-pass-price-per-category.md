# POOLSE-203 · A free-swim pass has a price per category, and per combination where the club types one

> Part of the Poolse backlog. Conventions in [CONVENTIONS.md](./CONVENTIONS.md) apply to this ticket and are not repeated here.

**Type:** Feature · **Area:** Reception / Billing · **Priority:** Medium (pilot) · **Depends on** [POOLSE-202](./POOLSE-202-a-category-on-the-person-with-proof.md), [POOLSE-68](./POOLSE-68-free-swim-passes-and-check-in.md)

### As built (08-11-2026) — wins over what follows

- **Fallback** (Rui, 08-11-2026): rule 2(c) wins over the old QA 3. An unpriced category is skipped and the next ranked with a price applies; the base price only when none does.
- **Schema**: `pass_product_price` with `category_ids uuid[]` (sorted, no repeats, by CHECK through `category_set_is_canonical()`), one live price per exact set, and a trigger that refuses another club's category as a foreign-key violation. Migration `1794654400000_pass-price-per-category.sql`.
- **`pass_price_for(org, product, membership)`**: one ordering of every held set (largest first, then by the positions of its categories in rank order), so singles and combinations are the same rule. Returns the amount, the set and the names joined by " + ".
- **Sale**: `sellPass` resolves the price inside its transaction and writes it to the line (`amount_cents`, `fee_category_name`) and the counter payment. `basePrice: true` is the override, audited on `pass.sold` with the price it overrode. Any `amountCents` in the body is a 422. Documents already print the names through `LineLabel`.
- **UI**: *Preços por categoria (n)* under each product on *Natação livre*. The sale form lists the person's prices, says *Preço: … (preço Sénior + Sócio)*, and offers *Vender ao preço base* only when the two differ.
- **Rule 6, `pass.shared`**: not added here. No pass is shared before POOLSE-204, so every pass, category-priced or not, is personal already. The column arrives with 204's family pack, where it first means something.
- **Tests**: `packages/db/test/pass-price.sql` (QA 1–4, isolation), `apps/api/src/reception/pass-prices.integration.test.ts` (QA 1, 2, 4, 5, 6, refusals), role-probe lines. Walked in a browser: the price table, a refused one-category combination, a saved combination, and the sale preview with the base override.

### PO — why this exists

Rui, 08-11-2026: a pack of entries priced by who buys it. *"If it's senior and sócio, it gets the senior discount, and it only gets a discount on sócio if the club wants. This should be customizable, not default."*

### Decided (Rui, 08-11-2026)

- **Own price per category**, per pass product, rather than a percentage.
- **Combinations:** any mix of categories may have its own price, **but only where the club types one**. A mix with no price falls back to the top-ranked category's price. So nothing combines unless the club says so.
- **A category-priced pack is personal.** It is not shared with the family (POOLSE-204's family pack is its own product).

### BA — rules

1. New `pass_product_price`: `product_id`, a **set** of categories (one or more), `amount_cents`. Unique per product per exact set. The base price stays on `pass_product`.
2. **Resolving the price** is one SQL function, `pass_price_for(org, product, person)`:
   - (a) take the person's live categories (POOLSE-202);
   - (b) if a typed combination's set is a subset of them, the **largest** such set wins; on a tie, the set holding the higher-ranked category wins;
   - (c) else the top-ranked category's own price, if it has one; else the next ranked; else the base price.
   The function returns the price and the category set that produced it.
3. **Snapshotted on the sale.** The invoice line stores the amount and the category names, as fee lines already do (`fee_category_name`). Changing the price table later never touches a sold pack.
4. Reception's sale dialog shows the resolved price and why (*Preço Sénior + Sócio*). The office may override it to the base price, which is audited, and never to an arbitrary number.
5. The product panel shows a price table: the base price, one row per category, and *Adicionar combinação* to pick 2+ categories and type a price. No full grid of every mix.
6. **A category-priced pass is personal**: `pass.shared = false`, and only its holder checks in on it (POOLSE-204's rule 2).

### QA

1. Base 40 €, Sénior 30 €, no combination: a Sénior and Sócio person pays 30 €.
2. The same with a typed Sénior+Sócio at 27 €: they pay 27 €.
3. Sócio ranked above Sénior with no combination: they pay Sócio's price, or, if Sócio has none, Sénior's (rule 2(c); Rui, 08-11-2026, corrected from "the base price").
4. A Sénior whose proof expired yesterday: base price.
5. The price table changed after a sale: the sold line's amount is unchanged.
6. An override to an arbitrary amount → 422. An override to the base price is audited.

### Acceptance criteria
- [ ] Migration and `pass_price_for`, with the precedence in SQL only.
- [ ] Price table on the product panel; resolved price and reason in the sale dialog.
- [ ] Snapshot on the line; QA 1–6.
