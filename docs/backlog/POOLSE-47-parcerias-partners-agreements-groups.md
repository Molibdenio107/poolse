# POOLSE-47 · Parcerias: partners, agreements and groups

> Part of the Poolse backlog. Conventions in [CONVENTIONS.md](./CONVENTIONS.md) apply to this ticket and are not repeated here.

**Type:** Feature · **Area:** Installations / Partnerships · **Priority:** High

### PO — why this exists
A large share of a municipal pool's water is sold in blocks to organisations, not to families. The
reference club's morning is almost entirely `ES D. Dinis` (a secondary school, booked per school
class, some marked `DE` for desporto escolar), `EPA`, `Teresianas`, `Misericórdia (Hidroterapia)`,
`JI Vinha`, `CAID` and `Andebol Sub 16`. None of them has a single student record in Poolse, and
Poolse cannot represent any of them — so the product currently shows a club its pool is empty all
morning when in fact it is full and paid for.

The tab lives on the **Facility detail page**, beside Configuração and the tabela de preços: a
partnership is an agreement with that building, the same shape as the price list that already lives
there.

**Not in scope:** the Excel import (POOLSE-48), putting partner groups on the grid (POOLSE-46 defines
the booking; POOLSE-49 draws it), and any revenue dashboard (POOLSE-52 exposes the numbers; the
dashboard is a later module).

### BA — rules and data
- `partner`: `facility_id`, `name`, `type`
  (`escola | agrupamento | ipss_misericordia | jardim_infancia | clube | camara | empresa | outro`),
  `nif?`, `address?`, `notes`, `status` (`ativa | inativa`), `color`.
- `partner_contact`: `partner_id`, `name`, `role`, `email`, `phone`. Several per partner — a school
  has a head of department and an office.
- `partner_agreement`: `partner_id`, `season_id`, `start_date`, `end_date`, `billing_model`
  (`por_hora_pista | por_bloco | por_participante | mensal_fixo`), `unit_price`, `vat_rate`,
  `payment_period`, `notes`, `document`.
- `partner_group`: `partner_id`, `name` (`6A`, `10G 11B`, `Hidroterapia`), `participant_count`,
  `level_id?`, `brings_own_instructor`, `own_instructor_name?`, `tag?` (e.g. `DE`), `notes`.
  **The group, not the partner, is what gets dropped onto the grid.**
- A partner belongs to one facility. A school that uses two of the club's pools is two partner rows —
  considered and accepted, because the agreement, the price and the contact are per building and one
  partner spanning sites would make every one of those a list.
- `unit_price` is **gross**, with `vat_rate` allowing `isento`, exactly as the mensalidades rules
  already do (POOLSE-42). Money is integer minor units; a per-hour lane price is a unit price and is
  therefore `numeric(12,6)`, not cents — CLAUDE.md's rule, and the reason it exists: a lane-hour at
  €14.375 rounded to cents is wrong by the time it is multiplied by a season.
- `document` is the signed contract. **Present, styled and visibly disabled**, exactly like the logo
  and photo controls, until file storage lands. One decision unblocks all of them.
- `status` `inativa` hides a partner from the pickers without destroying its history — a partnership
  that lapsed still explains last season's grid.
- Colour is the partner's, and it drives its cells on the grid. It never carries meaning alone: the
  cell always shows the group name as text too.
- The nominal roster per group — names only, no Poolse accounts — is **modelled and shipped
  disabled**. The club may not have the data, and a feature that asks for a list nobody has is a
  feature that makes the screen look broken.
- **Open — Open question 3 (billing).** Are partnership hours invoiced through the mensalidades
  engine or a separate flow? *Recommendation, and worth deciding before POOLSE-52:* keep them
  **separate**. The mensalidades engine bills a student a monthly plan against enrolments; a
  partnership bills an organisation for lane-hours against a contract, with a NIF and quite possibly
  a different VAT treatment. Forcing both through one engine would make the student path carry a
  concept it does not have. This ticket therefore stores the agreement and computes what is
  contracted; it issues nothing.
- **Open:** does an agreement need to survive a season change without being re-entered — a two-year
  contract? *Recommendation:* `season_id` nullable, meaning "runs until ended", with `start_date` and
  `end_date` as the truth.

### Dev — implementation notes
- Four tenant-scoped tables, each with the composite key to its parent:
  `partner → facility`, `partner_contact → partner`, `partner_agreement → partner`,
  `partner_group → partner`. `partner` needs `unique (organization_id, id)` for the three children.
- `partner_group.level_id` is a composite FK to `student_level`, so a school class can be pointed at
  a level and inherit its capacity guidance — the same level ladder the turmas use.
- Partial unique indexes on soft-deletable tables, as always: partner name per facility, group name
  per partner, both on `lower(strip_accents(name))`.
- `participant_count` is `integer not null default 0` with `check (participant_count >= 0)`. Zero is
  a real answer for a group that has not been sized yet.
- **Most likely to be got wrong:** `unit_price` as cents. It is a unit price. `numeric(12,6)`.
  The contracted total *is* money and is `amount_cents`.
- Second: the list's derived columns — horas/semana and pistas·hora/semana — must be computed in SQL
  over the published season's bookings, not in JavaScript over a page of partners. Filtering after
  paging is the failure CONVENTIONS names.
- Pagination: the partner list **is** paginated at 15. A club's partner list grows as it sells more
  water. The groups table inside one partner is exempt — bounded by the partner.
- The facility page is already several stacked sections; adding Parcerias as a fifth is consistent
  with Configuração and the price list rather than introducing a tab bar for one ticket. If the page
  is genuinely too long, that is its own ticket, not this one's problem to solve halfway.

### QA — test scenarios
- **47.1** Given an admin / When they create a partner with a name, type and colour / Then it appears in the facility's partner list.
- **47.2** Given a partner / When a second is created with the same name in different case or accents at the same facility / Then it is refused.
- **47.3** Given the same name at a *different* facility / When created / Then it is accepted.
- **47.4** Given an archived partner / When a new one is created with its name / Then it is accepted.
- **47.5** Given a partner with three groups / When the list renders / Then nº de grupos reads 3 and horas/semana is computed from the published season's bookings.
- **47.6** Given a partner with no bookings / When the list renders / Then horas/semana is 0, not blank.
- **47.7** Given a group with `brings_own_instructor` / When it is placed on the grid / Then the booking's `instructor_status` is `external` and the group's own instructor name is shown.
- **47.8** Given an agreement at `por_hora_pista` with a unit price of €14.375 / When the contracted value is computed / Then the price is not rounded to cents before multiplication.
- **47.9** Given an agreement marked `isento` / When VAT is computed / Then it follows the same rule as an exempt mensalidade.
- **47.10** Given the contract upload control / When it renders / Then it is visibly disabled and says why, and no file picker opens.
- **47.11** Given a partner set to `inativa` / When the grid's partner picker opens / Then it is not offered, and last season's bookings still name it.
- **47.12** Given 20 partners / When the list renders / Then it is paginated at 15 and the counts on page 2 are consistent with page 1.
- **47.13** Given an instructor / When they POST a partner / Then the API refuses it.
- **47.14** Given tenant A's partner / When tenant B reads partners, groups, contacts or agreements / Then none are returned and B cannot attach a booking to A's group.
- **47.15** Given pt-PT and en / When every partner screen renders / Then all eight types and all four billing models exist in both.
- **47.16** Given light and dark mode / When a partner's colour swatch renders / Then it is distinguishable in both and is never the only cue.

### Acceptance criteria

1. `partner`, `partner_contact`, `partner_agreement` and `partner_group` exist, tenant-scoped, each keyed compositely to its parent.
2. A partner belongs to one facility and appears on that facility's page beside Configuração and the price list.
3. Partner and group names are unique per parent, accent- and case-insensitively, on partial indexes.
4. `partner_group` is what a booking references; a group carries its participant count, optional level, own-instructor flag and tag.
5. Unit prices are `numeric(12,6)`; contracted totals are integer minor units; VAT supports `isento` on the same rules as mensalidades.
6. The signed-contract upload is present, styled and visibly disabled with the reason named.
7. An inactive partner disappears from pickers and keeps its history.
8. The partner list shows nº de grupos, horas/semana, pistas·hora/semana, valor contratado and estado, all computed in SQL over the published season.
9. The partner detail shows identification, contacts, the current agreement, the groups table, and a read-only Horário panel of that partner's slots.
10. The nominal roster per group is modelled and shipped visibly disabled.
11. The partner list is paginated at 15; the groups table within a partner is exempt and the exemption is recorded in CONVENTIONS.
12. Partner management is owner/admin, enforced in the API, with a denial test per endpoint.
