# Students — the adult and senior path

What a club records about a person, and how that differs when the person is an adult.

## Which path somebody is on

An **adult** is a student at or above the club's own `age_of_majority` with **no live guardian
link**. The absence of the edge is the definition — there is deliberately no `is_adult`
column, so correcting a birth date or adding a guardian moves somebody between paths with
nothing to migrate.

Two consequences worth stating, because both are easy to get wrong from age alone:

- An **adult who has a guardian** is on the guardian path. A supported adult is precisely the
  case the distinction exists for.
- A student with **no birth date on file** is on the guardian path. Guessing "adult" for
  missing data skips the guardian block for a child nobody has finished registering, which is
  the mistake you cannot recover from; guessing the other way asks for a guardian an adult is
  then corrected out of.

The answer is computed **once, on the server** (`student_is_adult_path`) and travels with the
medical page as `enrolment`. The screens branch on it; none of them re-derives it.

## Consent

The server chooses the form — `self` for the adult path, `guardian` for everyone else — and
**validates it on the way back**. A request that claims a fifteen-year-old with a guardian
signed for themselves is refused with **422**, and so is one claiming a guardian signed for an
adult who has none. The request is well-formed; what is wrong is the claim about who signed,
which only the server is in a position to check.

A caller that says nothing about who signed is accepted. `signedBy` is optional, and absent
means "the client did not say" rather than "the client said self".

## Medical and mobility notes

**Mobility and physical limitations sit beside the medical notes**, in the same table, under
the same encryption, the same audited read and the same permission. They are the same class of
fact: something about a person's body that whoever is at the poolside needs to know before that
person is in the water.

**Who may read them: the owner, an admin, and any instructor.** Slice 1.12 settled this for the
medical notes and considered narrowing it to an instructor's own turmas — rejected, because the
person covering a colleague's class at short notice is exactly who would be locked out. The
**unconditional audit log** is what makes the open read safe: every read is an event, recorded
with who did it. The note itself is never written to the log.

Writing is the owner and admins. Both boxes save together, under one Save.

## The emergency contact

Who to call. It is **either a person already in the club or a name and a number**, never both —
a link keeps the name right when that person changes it, and choosing one clears the other
rather than refusing the pair.

**Naming somebody grants them nothing**: no role, no login, no access to the student's record,
and no place in any guardian list. That is a property of the shape rather than of a check — the
contact is three columns on `student`, touching neither `membership_role` nor `guardian_link`,
so there is no path by which it could confer anything. The form says so in words, because a
contact block under a medical page looks exactly like the guardian block one screen over.

The picker lists **every** active membership rather than a page of them: a picker built from
one page offers only the people who happened to land on it, and the operator concludes the
person is not in the system and types the name in by hand.

## The fee category

Why one person pays a different price from the person in the next lane: **Sénior**,
**Estudante**, **Funcionário**. A club invents its own, so it is a list the club maintains
rather than a fixed set.

**The category carries what it is worth** — a percentage or a fixed amount, one or the other
or neither. This *reverses* POOLSE-23's "a reference, never a percentage": nothing consulted
the reference, so a club giving seniors 20 % off typed −20 and the word "sénior" into a
free-text reason once per family. One decision with forty authors is exactly what the original
rule was written to prevent. `docs/decisions.md`, 2026-09-14.

**A category with no value is still a category.** It is a label — a club may keep
"Funcionário" to count them — and it is not 0 %, which would be a decision somebody took.
Nothing is charged differently for it.

**The figure is snapshotted onto the fee line.** Correcting what a category is worth reaches
every line agreed *afterwards* and none agreed before, exactly as the price list does: a line
that re-read its category would re-price a family the moment somebody fixed a typo. Renaming
still reaches everything at once, because the line holds the id.

**One author, never two.** A line's discount comes from a category or from a person, and the
form is a single control with three answers — no discount, one of the club's concessions, or a
figure typed with a reason. A request carrying both is refused rather than resolved by
precedence. A typed discount still requires a reason; the category *is* the reason for the
other kind.

**All four fee kinds.** A senior concession on the quota and a waived inscrição for staff are
both ordinary, and the schema treats the four as one price list.

**Set on the turma or on the enrolment, and the enrolment wins.** A senior turma carries the
category so nobody types it forty times; the one member of it who is staff carries their own.
Clearing a person's own category puts them back on their turma's — *not* on none, which is why
that clear is its own action rather than saving an empty value.

When a fee is charged, the student's category is **suggested** — the one every live enrolment
of theirs resolves to, and nothing at all the moment two of them disagree, because a child in a
senior turma and a staff turma is somebody a person has to choose for. A suggestion is
pre-selected and confirmed, never applied behind somebody's back, and an *existing* line shows
what it was agreed at rather than what would be suggested today.

A category a turma or an enrolment still names cannot be archived, and the refusal counts both.
Fee lines are deliberately not counted: a line holds the figure it snapshotted rather than a
live reference, so old lines naming an archived category read correctly, and counting them
would make a category unarchivable for ever the first time it was used.

Reading the **names** is open to anyone who may see a turma — the label is printed beside a
turma and on an enrolment. Reading what a category is **worth** is not: the price list refuses
an instructor outright, so the values come back null with `canSeeValues: false` beside them
rather than as a blank that would read as "no discount". Writing is the owner and admins.

**Where each is set.** The club's list is a panel on each site's page, under **Instalações →
*site* → Preços**; the old **Alunos → Categorias** route redirects there. The list is still the
club's and organization-scoped — the same categories on every site — and the panel says so,
because a "Sénior" meaning one thing at one pool and another at the next is a concession nobody
could report on. A turma's category is part of the turma's own form, beside its level and its
pool — there is deliberately no separate endpoint for that one field, because a second write
path is how two screens end up disagreeing about what was saved. A student's own category is
set from their enrolment, which has no form of its own.

On a document, the concession is printed by name beside the line: the amount is already net of
the discount, so without it an invoice says 28,00 where the price list says 35,00 and nothing
accounts for the rest. The name is snapshotted onto `invoice_line`, like every other name on a
document.

## Both capacities, one record

A person who is an adult student **and** an encarregado de educação is one record and appears
once in Alunos, with a badge for each. She has to: the list is over `student`, and she has one
student record.

The half worth stating is how "guardian" is asked. It is an **outbound** edge — she is
somebody's encarregada. Asking "does this person have any guardian edges at all" finds the ones
she holds over her granddaughter, which would take her off the adult path and address her own
consent form to a parent she does not have.

## Levels

Senior levels sit in the **same ladder** as everything else, ordered by the same `sort_order`
and bounded by the same age range. Not a parallel programme: POOLSE-19's "next level" logic
walks that one ladder, and a second list would need a branch in it.

## Not built yet

- **AC7 — communications routed to the adult student rather than a guardian.** There is
  nothing to route: `notifications/` sends invitation and vacation email and no messaging
  feature exists. The rule is written down in the ticket and should be built with the feature
  it belongs to, not stubbed ahead of it. It is the only criterion of POOLSE-23 still open.
