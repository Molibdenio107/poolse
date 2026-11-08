# Reception — free swim, passes and check-in

POOLSE-68, roadmap 7.2. **Receção** (`/dashboard/rececao`), and a **Natação livre** panel under
each site's **Preços** tab.

## What it does

Somebody walks in, pays for one entry or a pack of ten, and swims. Reception sees how full each
tank is now, sells entries and passes, and lets people in.

**What a site sells** (Preços → Natação livre) comes in three shapes:

- **Entrada avulsa**: one entry, good on the day it is sold.
- **Pack**: N entries, either never expiring or good for a number of days from its first day.
- **Passe por período**: unlimited entries for a number of days (30 for a month).

Each is priced like a fee: gross, with the VAT inside it, or exempt. Changing a product applies
to later sales only, because a sold pass keeps its own copy of what it was sold as. Taking a
product off sale leaves the passes already sold valid until they end.

**The default stay** sits on the same panel: 90 minutes unless the club changes it (15–720).
After that long, a check-in no longer counts as in the water, whether or not anybody recorded the
person leaving.

## At the desk

- **Na água agora**: each tank shows people in the water out of its capacity, split into free
  swim and classes. A turma counts its active enrolments and a parceria its headcount, never a
  turma's ceiling. A tank with no capacity set says so and refuses nothing.
- **Entrada avulsa**: sells an entry to nobody in particular and lets them in, in one press.
- **Cliente**: find somebody by name, email or NIF, or add a new person (a walk-in gets no role
  and no login). Their passes are listed with what each one is good for: entries left, valid
  until, ended, used up, or cancelled by a credit note. Next to each live pass is *Dar entrada*,
  and below the list a form sells them a new pass, optionally letting them in at once. A pass
  that starts on a later day is sold without the entry, because it cannot let anybody in today.
- **Em natação livre**: who is in the water on a pass, since when and until when. *Saída*
  records an early check-out. *Anular* takes back a check-in entered by mistake: the entry goes
  back on the pack and the place in the tank is freed.

At a site with several tanks, reception chooses the tank once, at the top, and every entry goes
into it.

**Nothing is disabled to say no.** A full tank, a pack with no entries left, a pass that has
ended or not started, a pass that was credited, and a pass somebody is already swimming on are
all refusals in words, with their figures: "O tanque leva 40 pessoas e já há 40 na água."

## The money

**A sale is a document.** Each sale writes a one-line invoice in the site's default series. The
line names the pass, and the payment taken at the counter is recorded with it. A sale refused at
check-in (for example, the tank is full) sells nothing.

**An anonymous entry is a document with no payer**, printed as *Consumidor final*.

**A credit note on the document voids the pass.** Nothing about a pass is ever edited.

These documents appear in Faturação like any other, with *Natação livre* and the product's name
on the line.

**Pass revenue is its own figure.** Receção and the dashboard's *Natação livre* card show what free
swim sold this month: sale lines on documents issued this month and not since credited, plus the
month's entries. It is never added to the mensalidades card, which goes on counting only
mensalidades.

## Who can do it

| | Owner | Admin | Instructor | Others |
|---|---|---|---|---|
| Define products and the default stay | ✓ | ✓ | — | — |
| See reception, sell, check in and out | ✓ | ✓ | — | — |

There is no reception role. The endpoints refuse everybody else, and the menu item is not shown
to them.

## Rules

- A pass is used only at the site that sold it.
- Only an *entrada avulsa* may be sold to nobody in particular. A pack or a pass belongs to a
  person.
- One person in the water per pass at a time.
- The last place in a tank and the last entry on a pack each go to exactly one of two racing
  check-ins.

## On the calendar and the dashboard

A lane can be held for free swim on the calendar (`calendar.md`), which keeps turmas off it. The
dashboard's *Natação livre* card (owner and admin) shows each tank now and the month's sales. It
moves up the band when a tank is 90 % full, and it is empty for a club that sells no free swim.

Out of scope altogether: turnstiles, QR cards, online sales and a till.

## Closed tanks — POOLSE-84

A tank shut now by a closure says **Encerrado até dd-MM-yyyy** (or *esta manhã* / *esta
tarde*) with its reason on its occupancy card, and reads *(encerrado)* in the tank picker. A
check-in on it is refused by the check-in trigger under the pool lock — "Este tanque está
encerrado até …. Escolha outro tanque." — while another tank of the same site takes the
swimmer.

## Person categories — POOLSE-202 (08-11-2026)

The office ticks a category (*Sénior*, *Sócio*, *Munícipe*…) on a person after seeing proof: the date it was seen, who saw it, and valid until (blank = no expiry). The notes say what was seen, never its number. No copy of the document is kept. Poolse never decides eligibility.

- **Where**: a *Categorias* card on the student record (General tab) and in Receção's person panel for somebody who is not a student (Rui, 08-11-2026). Add, *Renovar* (new dates) or *Remover* (asks first; an archive). Each change is audited (`person_category.added/renewed/removed`).
- **Who**: owner and admin; there is no reception role. Instructors and families are refused by the API.
- **Expiry**: *Categorias a expirar* on the Receção page lists every category with 30 days or fewer left, soonest first, and the menu's *Receção* carries the attention circle while any are listed. An expired one reads *Expirou a dd-MM-yyyy* on the card; the next sale is at the base price (POOLSE-203), and packs already sold are untouched.
- **Rank**: the categories panel on a site's *Preços › Descontos* has a second drag list, *Prioridade no preço das entradas*: the first category a person holds sets their pass price. It does not change the display order or monthly fees. The panel also says, as visible text, that a residence-based price is the club's decision and responsibility.
- **Family app**: *Perfil* lists the reader's own valid categories with their expiry, never the proof (`GET /app/categories`).
- **API**: `GET/POST /person-categories`, `PATCH /person-categories/:id`, `POST /person-categories/:id/archive`, `GET /person-categories/expiring`, `POST /fee-categories/rank`.

## Pass prices per category — POOLSE-203 (08-11-2026)

- **On the product** (*Preços › Natação livre*, *Preços por categoria*): the base price, one row per category (its own price or *Preço base*), and *Adicionar combinação* for two or more categories with a typed price. Nothing combines unless the club types it. Removing a price asks first and archives it.
- **Which price**: the largest set of categories the person holds that has a price; on a tie, the higher-ranked. With no typed combination that is the highest-priority category that has a price, skipping one without. None: the base price. `pass_price_for()` in SQL is the only place this is decided.
- **At the sale**: the product list shows the person's prices, and under it *Preço: 27,00 € (preço Sénior + Sócio)*. *Vender ao preço base* is the only override, and it is audited. The sale resolves the price again on the server; the document line keeps the amount and the category names, so a later price change never touches a sold pass.
- An anonymous single entry pays the base price.
- **API**: `PUT /facilities/:id/pass-products/:productId/prices`, `POST …/prices/:priceId/archive`, `GET /facilities/:id/reception/people/:membershipId/prices`; owner and admin.
