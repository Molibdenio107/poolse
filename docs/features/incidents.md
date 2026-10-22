# Ocorrências — bather incidents

POOLSE-70, roadmap 7.4. **Instalações → Ocorrências** (`/dashboard/facilities/incidents`).

## What it does

When something happens to a bather, such as a slip on the deck or someone pulled from the water,
the club records it the same day as a dated record it can show an insurer.

**The facts** are recorded and read by any staff member (owner, admin, instructor,
maintenance):
- when it happened (the site's local time; a time in the future is refused);
- where: a tank, a space, or elsewhere on the site;
- who: a student, another person the club knows, or a visitor by name, exactly one;
- whether emergency services were called;
- the lifeguard on duty, as the writer recorded it;
- a policy reference.

**The clinical detail** is what happened, the injury, and the first aid given. It is
**encrypted** before it reaches the database (the same AES-256-GCM as students' medical notes).
The database refuses anything in those columns that is not ciphertext. Only the **owner, the
admins and the person who wrote it** can read it, by pressing *Mostrar detalhe clínico*, and
every read is logged.

## Written once

Nothing about an incident is ever edited. A correction is an **addendum** with its own author and
time, shown under the original in order. It is encrypted and read under the same rule as the
detail, since a correction is as likely to be about the injury as about the time. Owner and
admin can **archive** an incident; the record stays.

After recording, the form returns to the list for that site with a success toast, and the new
incident's row is lit for a moment (`?new=<id>`) so it is seen to have landed (POOLSE-92).

## Who can do it

| | Owner | Admin | Author | Other staff | Student / guardian |
|---|---|---|---|---|---|
| Record an incident, read its facts | ✓ | ✓ | ✓ | ✓ | — |
| Read the clinical detail, add an addendum | ✓ | ✓ | ✓ | — | — |
| Archive | ✓ | ✓ | — | — | — |

## The lifeguard on duty — slice 2

**Instalações → Nadadores-salvadores** (`/dashboard/facilities/lifeguards`) shows who is the
lifeguard on each tank, week by week. Owner and admin write it; all staff read it; a family
sees none of it.

- **Anyone on the staff can be rostered**, a teacher included. **Several people may be on duty
  on one tank at once, and none is required.** The one refusal is the same person entered twice
  on the same tank at overlapping times, which is a typo.
- What makes someone a valid lifeguard is a qualification (Equipa → Qualificações) of a type
  marked as counting. Every club has *Nadador-salvador (ISN)* marked.
- **Two warnings, neither a gate.** A rostered person with no valid lifeguard qualification on
  that day is said beside their duty. An open window with nobody on duty is said as exact times
  ("sem nadador-salvador das 11:00 às 13:00"), from the site's opening hours minus the duties.
- **A new incident pre-fills the lifeguard** from the roster for that tank and moment, and the
  writer can change it. The incident page says if the recorded lifeguard did not hold a valid
  qualification on the incident's day. It is a warning, and the incident is saved regardless.

### Vigilance periods — 12 October 2026

The page has two views: **Escala da semana** and **Períodos de vigilância**. A period rosters one
person on many days at once: **one or more tanks**, a **from and until date** (at most 400 days),
the **weekdays**, and either **the site's opening hours** of each day or **fixed hours** (an end
before the start runs past midnight).

- Saving writes one ordinary duty per covered day per tank. Days the site is shut and days a
  closure covers are skipped. A day the person already holds on that tank is left as it is and
  counted ("12 dias escalados · 1 já estava escalado"), never a refusal of the whole period.
- Those days appear in the week view marked *do período*, and any one of them can still be
  removed on its own (a sick day).
- **Terminar a partir de** a date (today or later) removes the period's days from that date on;
  the days before stay as the record. Ended from its first day, the period disappears.
- Owner and admin only, as the rest of the roster.

## The insurer's PDF — slice 3

On an incident's page, **PDF para a seguradora** opens the record as an A4 page and the print
dialog (*Guardar como PDF*). It contains the facts, the clinical detail, every addendum in
order, and the recorded lifeguard's licence **as it stood on the incident's day**: each
lifeguard-type record with its dates and whether it was valid then. That is derived at the
moment of export and printed. Because it holds the clinical detail, only the owner, the admins
and the author can produce it. Each export is written to the audit log as `incident.exported`.
