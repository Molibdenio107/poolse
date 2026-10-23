# Pre-registration

POOLSE-69, roadmap 7.3. **Alunos → Pedidos de inscrição** (`/dashboard/students/pedidos`), and
the public form at **`/inscricao/<slug>`** (`?lang=en` for English).

## The public form

A family fills in a request from a link on the club's website or a poster at reception. There's
no login and nothing to pay. The form asks for:

- the swimmer: name, surname, birth date and, optionally, a NIF;
- for anyone under the club's own age of majority, a guardian with a full name and a
  relationship (the guardian's NIF is optional). The form uses the same age that conversion
  will check;
- an email, which is the guardian's for a minor, and an optional mobile number;
- a preferred site (offered only when the club has more than one), level and days;
- a note, which tells the family not to put health information in it;
- the consent sentence, which names the club and the 12-month archive. The request records the
  sentence's version and when it was ticked.

**The club opens the form, and it is closed by default.** Until the Owner opens it, the link
says *Este formulário não está disponível*, exactly as an address no club uses does.

**The answer never depends on the club.** Once a request is shaped like a sign-up, the family
always reads *Recebemos o seu pedido*. Three things are refused silently, and none of them
changes that answer:

- A hidden honeypot box that has been filled in.
- A form that wasn't rendered recently: an HMAC stamp issued with the page must be between 3 s
  and 24 h old.
- More than 3 sends in 10 minutes from one visitor (`x-poolse-client-ip`, which the web forwards as
  signup does). The API believes that header only with `WEB_PROXY_SECRET`, when one is set.

The database adds two more silent refusals:

- An unknown, closed, suspended, archived or read-only club.
- More than 30 requests to one club in 10 minutes. This one is **recorded**
  (`lead.ceiling_reached`, once per window), and the Pedidos page shows a warning for a week:
  a flood would otherwise hide every real request from the club. One visitor can no longer
  fill it alone — 16-10-2026 security sweep.

A site or level id that isn't the club's becomes *no preference*. A malformed body is a 400
naming its fields, decided before any club is looked at.

## The queue

Owner and Admin. Three sections:

- **Por tratar:** new requests and booked trials.
- **Tratados:** waitlisted, enrolled and dismissed requests.
- **Formulário público:** the switch and the address.

Everything a family sent is visible text on the request's card. Each answer is one dialog and
one call:

- **Inscrever** creates the student and guardian and enrols them in a chosen turma, in one
  transaction. A full turma refuses and leaves nothing behind.
- **Lista de espera** does the same and puts the student on the turma's waiting list.
- **Aula experimental** books one occurrence in the next four weeks.
  - It takes a place counted by `session_free_seats()`, beside the reposição guests.
  - A full occurrence refuses with its numbers.
  - A cancelled class, a class that has started and a partnership hour all refuse.
  - A booked trial can be moved, and after the trial the request is still open for one of the
    other answers.
  - **The class's register names who is coming**, with their age on the day, above the roll.
    A trial guest isn't a student, so they are never marked; dismissing the request takes them
    off.
- **Dispensar** needs a reason. Nothing is sent to the family.

**Choosing the turma** (POOLSE-110) is `TurmaPicker` (`components/turma-picker.tsx`) in Inscrever, Lista de espera and Aula experimental — a list, not a dropdown:

- grouped by level, the requested level first under *Nível pedido*, then the ladder in order, then turmas with no level;
- each row the turma's name, its weekly slots, its instructor and how full it is, a bar *and* "8 / 12" (or *sem limite*);
- a full turma is shown, in muted ink and marked *Cheia*, and can be picked only for the waiting list (*Cheia — só lista de espera*); within a level it comes after the ones that can be picked;
- a search box filters as you type, by turma, level or instructor, ignoring accents and case;
- keyboard: the search box owns the list — arrows move through the pickable rows, Enter picks, Escape closes the list back to an earlier choice (the dialog lets it), and the choice is announced;
- the choice is said back as one line with *Alterar*; Inscrever and Lista de espera stay disabled until a turma is chosen, and Aula experimental lists the turma's next dates only then;
- on a phone the dialog is a full-height sheet, so the picker is too.

The new-student enrolment form and the app's enrolment (POOLSE-82) still use their own controls; swapping them to the picker is a follow-up.

Waitlisting and enrolling go through the student form's own rules (`parseStudent`):

- the club's age of majority and the guardian requirement;
- the NIF checksum, and one NIF per person;
- guardian matching on NIF, else email.

**A swimmer NIF that already belongs to a student attaches the request to that student** rather
than creating a second one. The free-text note is never copied onto the student.

**On the dashboard**, `mgmt.leads` (Owner and Admin) counts the requests waiting and the trials
booked, and says how long the oldest has waited. It moves up once a family has waited 3 days.

## The address

The address is `organization.slug`, the same one the club has had since signup. **Only the
Owner** can change it or open and close the form; an Admin sees the link. A taken address is
refused by name, and **an address a club has ever used stays that club's** (`slug_claim`).
Another club can never take it, so a poster printed before a rename can't send families to
somebody else. Changing it moves the link every poster already prints, and the form says so.

## Retention

A request that never became an enrolment is **archived after 12 months** (`lead_retention()`)
by a daily job, run per club inside the club's own policy. Requests are never deleted.
Waitlisted requests are archived too; the student they created is untouched.

## Not built

There's no email to the family on receipt or on an answer; that waits for the notifications
phase. There's also no online payment,
no picking a session from the public form, and no parent account.
