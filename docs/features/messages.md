# Messages to families

POOLSE-67, roadmap 7.1. **Alunos → Mensagens** (`/dashboard/students/messages`).

## What it does

A club writes to the families of **one turma, one level, one site, or the whole club**, by
email, and keeps a record of who was told.

- **Who receives it** is worked out when it is sent: every student with an *active* enrolment in
  a live turma of the audience (a season that has ended does not count; the waiting list and
  students who left are not in the turma). A level means the students in that level's turmas.
- For each student: **their live guardians**, or — with none — **the student themselves**, at
  the address on their record. The same order the invoice payer uses.
- **One email per address.** A parent of two siblings gets one.
- **Nobody is dropped silently.** A student with no address anywhere is named in the
  confirmation before sending and recorded as *sem contacto* afterwards.
- The site audience is offered only to a club with more than one site; with one, it is the
  whole club.

## Sending

*Rever destinatários* asks the server who the message reaches and opens a confirmation with the
count, the students who cannot be reached, and — where no email provider is configured — a
sentence saying the message will be recorded and not sent. Only *Enviar* in that dialog writes.

The message and every address are recorded first; the emails go afterwards, one per address,
and each is stamped as it leaves. A message whose emails have not left (no provider, or the
provider refused) says *Registada — ainda não saiu nenhum email* rather than implying a family
was told. The text arrives exactly as typed, with one line from Poolse naming the club and
saying replies do not reach it.

**An email that did not leave is tried again** (POOLSE-86): every hour, for 48 hours, up to five
times, for messages and for every other email Poolse sends — water and lab alerts, qualification
alerts, trial and support notices, platform alerts. Each retry is the same email the first attempt
would have been, rebuilt from what was recorded. Invitations are the exception: their link is not
stored, so *Novo link* is how one is re-sent. Nothing is retried while email is not configured.

After **Cancelar aula** on the calendar, the success message offers **Avisar as famílias**,
opening the composer on that turma with the date in the subject. A parceria offers nothing.

## Who can do it

| | Owner | Admin | Instructor | Others |
|---|---|---|---|---|
| Write to any audience | ✓ | ✓ | — | — |
| Write to their own turmas (turma's instructor or a booking's) | ✓ | ✓ | ✓ | — |
| Read the history | every message | every message | messages to their turmas, the office's included | — |
| Archive a message | ✓ | ✓ | — | — |

Enforced by the API; the menu entry and the composer's options only follow it.

## Rules

- **A daily ceiling: 20 messages or 2,000 addresses per club**, per Lisbon day, whichever comes
  first. A send that would cross it is refused with the figures ("já enviou 20 de 20 mensagens
  hoje"). Enforced in the database, so two sends at once cannot both squeeze in.
- **Nothing is edited or deleted.** A message can be archived, which hides it from the list;
  its words and the record of who received it stay. Recipient names and addresses are as they
  were when sent, so a guardian unlinked since still shows as told.
- **Not built** (phase 3.0): push, SMS, replies, scheduling, attachments, per-person preferences.

## Written from a closure — 12 October 2026

A closure can send its own message (`closure` audience, `message.closure_id`). It reaches the
families of turmas with a lesson that closure cancelled. It is never offered in the composer;
it is sent from the closure dialog in Encerramentos (`calendar.md`).

**Partners and trial leads — POOLSE-84.** The `closure` audience now covers every closure made
by the same form (`closure.batch_id`) and reaches, besides families, each affected parceria's
partner — one row per live contact with an e-mail, or one row with none so the partner is
counted as unreachable — and every `trial_booked` lead whose session the closure cancelled. On
those rows `student_id` is null and `partner_id` or `lead_id` is set; the recipient list labels
them *Parceiro* and *Aula experimental*. No other audience ever reaches a partner or a lead.
