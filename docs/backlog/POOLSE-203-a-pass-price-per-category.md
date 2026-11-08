# POOLSE-203 · A free-swim pass has a price per category, and per combination where the club types one

> Part of the Poolse backlog. Conventions in [CONVENTIONS.md](./CONVENTIONS.md) apply to this ticket and are not repeated here.

**Type:** Feature · **Area:** Reception / Billing · **Priority:** Medium (pilot) · **Depends on** [POOLSE-202](./POOLSE-202-a-category-on-the-person-with-proof.md), [POOLSE-68](./POOLSE-68-free-swim-passes-and-check-in.md)

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
3. Sócio ranked above Sénior with no combination: they pay Sócio's price, or the base price if Sócio has none.
4. A Sénior whose proof expired yesterday: base price.
5. The price table changed after a sale: the sold line's amount is unchanged.
6. An override to an arbitrary amount → 422. An override to the base price is audited.

### Acceptance criteria
- [ ] Migration and `pass_price_for`, with the precedence in SQL only.
- [ ] Price table on the product panel; resolved price and reason in the sale dialog.
- [ ] Snapshot on the line; QA 1–6.
