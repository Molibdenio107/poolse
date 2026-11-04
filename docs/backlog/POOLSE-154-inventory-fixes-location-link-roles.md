# POOLSE-154 · Inventário: aligned form, a working *Localização* (spaces, pools, recintos), the name opens the item, and the roles are written down

> Part of the Poolse backlog. Conventions in [CONVENTIONS.md](./CONVENTIONS.md) apply to this ticket and are not repeated here.

**Type:** Bug · **Area:** Maintenance / Inventory · **Priority:** Medium (pilot) · **Depends on** [POOLSE-122] · **Unblocks** [POOLSE-155]

### PO — why this exists
Rui, 04-11-2026: "'Inventory' – when adding an item, the inputs are not aligned nor pretty"; "'Location' dropdown is not working, it should reflect the spaces created + pools or playing fields (a 'boia' belongs to 'piscina principal')"; "instead of having the 'edit' button, make the name of the item clickable"; "only owner/admin can delete each item, but maintenance can also add"; "lost and found can be created and 'mark as returned' by everyone, except students/guardians".

**Not in scope:** the lost-item request from the app (POOLSE-155); stock counts; the import.

### BA — rules
1. *Localização* lists, grouped: the facility's live `space`s, then its pools, then its other recintos. One choice. A pool choice writes `inventory_item_pool`; a space writes `space_id`; a non-pool recinto writes a new `inventory_item.playing_area_id`. **Open:** should an item be allowed in *several* pools (the table is many-to-many today)? Default: keep many-to-many in the schema, the form offers one.
2. The item form uses the shared two-column grid (as POOLSE-152 rule 3).
3. The list shows the item's name as a link to its edit page; the *Editar* button goes. Row actions keep *Arquivar* for owner/admin only.
4. Roles: owner, admin, maintenance create and edit (`INVENTORY_EDITORS`, unchanged); archive is owner/admin only (verify — CLAUDE.md says maintenance archives nothing; prove it with the probe).
5. Perdidos e achados: owner, admin, maintenance and instructor create and mark *Devolvido*; guardian and student get 403.

### Dev notes
- Migration (`write-migration`): `inventory_item.playing_area_id` with composite FK `(organization_id, facility_id, playing_area_id)`; the `location` free-text column stays (data-model note). Update `docs/data-model.md`.
- Why the dropdown is empty: check the form's `spaces` prop — the list is probably `outcome()`-refused for maintenance or not fetched; name the cause in the commit.
- Lost & found controller: `requireRole(owner, admin, maintenance, instructor)`; add to role-probe.
- Trap: `lost_item.status` enum is `found | returned`; do not add a value here (POOLSE-155 does).

### QA
1. Given a site with 2 spaces, 1 pool, 1 court, when the form opens, then *Localização* shows three groups with those entries.
2. Given a boia saved in *Piscina principal*, when the list renders, then its location reads the pool's name.
3. Given maintenance, when creating an item, then 201; when archiving, then 403.
4. Given an instructor, when marking a lost item returned, then 200; given a guardian, 403.
5. Given the list, when the name is clicked, then the edit page opens with `?from=` carrying the list's filter.
6. Cross-tenant `space_id` on a create → refused by composite FK.
7. Both themes; phone view of the form.

### Acceptance criteria
- [ ] Localização populated from spaces + pools + recintos and saved to the right column.
- [ ] Form on the shared grid.
- [ ] Name is the link; Editar button removed.
- [ ] Role rules enforced and probed for inventory and lost & found.
