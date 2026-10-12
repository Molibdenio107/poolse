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
