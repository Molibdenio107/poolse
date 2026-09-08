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

## Not built yet

The ticket's remaining criteria, and why each is separable:

- **AC4 — a fee category on the turma or the enrolment**, with the enrolment winning. It is a
  new concept on a price list that has just been reshaped, and belongs with the invoicing work
  rather than beside it.
- **AC6 — one record with both badges** for a person who is an adult student *and* an
  encarregado de educação. A students-list change, not a record change.
- **AC7 — communications routed to the adult student rather than a guardian.** There is
  nothing to route: `notifications/` sends invitation and vacation email and no messaging
  feature exists. The rule is written down in the ticket and should be built with the feature
  it belongs to, not stubbed ahead of it.
