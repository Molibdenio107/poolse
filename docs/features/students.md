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

**A reference, never a percentage.** What a category is *worth* belongs to the pricing engine,
which is not built. A number typed into a form here would be a discount nobody can report on
and nobody can change in one place.

**Set on the turma or on the enrolment, and the enrolment wins.** A senior turma carries the
category so nobody types it forty times; the one member of it who is staff carries their own.
Clearing a person's own category puts them back on their turma's — *not* on none, which is why
that clear is its own action rather than saving an empty value.

Renaming a category reaches everything at once, because a turma holds its id rather than a
copy of its name. A category a turma or an enrolment still names cannot be archived, and the
refusal counts both.

Reading the list is open to anyone who may see a turma — it is a label printed beside a name
and says nothing about money. Writing is the owner and admins.

**Where each is set.** The club's list lives at **Alunos → Categorias**. A turma's category is
part of the turma's own form, beside its level and its pool — there is deliberately no separate
endpoint for that one field, because a second write path is how two screens end up disagreeing
about what was saved. A student's own category is set from their enrolment, which has no form
of its own.

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
