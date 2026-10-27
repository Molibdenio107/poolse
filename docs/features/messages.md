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

**A family may stop the club's general messages** (POOLSE-86, Rui 19-10-2026). Every general
message ends with *Para deixar de receber as mensagens gerais de …* and a link that works with no
login: it names the club, says what stopping covers and what it does not, and offers *Deixar de
receber* or *Voltar a receber*. A member with a login has the same box on *O meu perfil*, for the
active club; each club is asked separately. An address that opted out is left out of the next
message, and the confirmation says how many were. **A closure warning always goes** and carries no
link, and so do invoice reminders, alerts and account emails.

**An email that did not leave is tried again** (POOLSE-86): every hour, for 48 hours, up to five
times, for messages and for every other email Poolse sends — water and lab alerts, qualification
alerts, trial and support notices, platform alerts. Each retry is the same email the first attempt
would have been, rebuilt from what was recorded. Invitations are the exception: their link is not
stored, so *Novo link* is how one is re-sent. Nothing is retried while email is not configured. Calls to the provider are spaced about half a
second apart, a rate-limited one waits and tries once more without spending an attempt, and a
call that hangs is abandoned after 15 seconds (sweep 19-10b). An alert about a reading archived
or corrected back inside its band before a retry is not sent at all.

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

## Written by Poolse when a lesson is cancelled — POOLSE-90 slice 4, 27 October 2026

When one lesson of a turma is cancelled, Poolse writes a `session` message
(`message.class_session_id`) inside the cancelling transaction (Rui: always, automatically). It
reaches that turma's families through `message_recipients()`, the same definition every other
audience uses.

- It is written in the club's language: *Aula cancelada: Golfinhos, 28-10-2026*, then the reason
  the canceller typed.
- It is sent by the person who cancelled.
- Like a closure warning it ignores the opt-out.
- Unlike anything else it is **exempt from the daily ceiling and not counted in it**, so a rainy
  Saturday's cancellations all go out. The ceiling exists to stop a person mass-mailing.
- *Anular* on the cancel toast puts the lesson back. When the cancellation had been announced, a
  second notice says the lesson is on after all.
- A parceria or free-swim block has no families and records nothing.
- The email is delivered and retried like every message. A push goes once to the same people's
  phones (`docs/features/app.md`).
- It is never offered in the composer: `MESSAGE_AUDIENCES` is what a person may write to.
- **A one-week move** of a lesson within the club's next seven days records a `session` message
  too (slice 4b): *Aula mudou: Golfinhos, 28-10-2026*, from when to when, only this week. Later
  moves record nothing.
- **A closure's warning is also pushed** to the people it reached, when it is sent.
