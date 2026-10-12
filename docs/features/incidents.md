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

## Who can do it

| | Owner | Admin | Author | Other staff | Student / guardian |
|---|---|---|---|---|---|
| Record an incident, read its facts | ✓ | ✓ | ✓ | ✓ | — |
| Read the clinical detail, add an addendum | ✓ | ✓ | ✓ | — | — |
| Archive | ✓ | ✓ | — | — | — |

## Not yet

The lifeguard duty roster with its two warnings (slice 2), and the PDF for the insurer (slice 3).
