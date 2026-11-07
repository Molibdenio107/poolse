# POOLSE-198 · A teacher asks for a substitute, and the office assigns one

> Part of the Poolse backlog. Conventions in [CONVENTIONS.md](./CONVENTIONS.md) apply to this ticket and are not repeated here.

**Depends on** POOLSE-197. **Priority:** High (pre go-live).

Rui: *"if the teacher cannot attend the class it should click on a button to 'request substitution', then a notification blink will display for owner/admin to then on the desktop app enroll another teacher to that class. The teacher, can also cancel a class if no substitute is able to attend, but the cancel option should be not easly accessed."*

1. **One lesson at a time.** A teacher requests cover for their own coming lesson, with an optional note, and may withdraw it. One open request per lesson.
2. **A circle blinks** for the Owner and Admin, on the menu and on the lesson, until the request is answered.
3. **The office assigns** on the desktop through the existing stand-in. The request closes, and both teachers are told.
4. **A teacher no longer picks a stand-in** (Rui, 07-11-2026): `POST /sessions/:id/stand-in` becomes office-only. This **reverses** the sweep of 13-10-2026.
5. **Cancel stays with the teacher,** any time, folded under *Mais opções*, with a required reason and a confirmation saying families will be told (Rui). The office's circle blinks too. The existing notice and its rules hold: a lesson that ended is the office's.

**Not in scope:** several lessons in one request (Rui); a long absence goes through the office, medical leave or holidays.

### Security review of the code (07-11-2026)

Fixed: under a view the register carries no exam state, insurance, note or cover note, closing a POOLSE-188 rule 8 gap on `/sessions/:id/attendance`. A colleague reads the roll and marks, with no photo, family notice or cover note, and the phone opens only the reader's own lesson. Only the teacher of that lesson asks for cover (`isOwnClass`). `cancel` refuses by role on its first line, and closing the request joins the cancel's transaction. Cover on a lesson that ended or was cancelled stops waiting.

**Open:** whether a colleague, in any sport, should still read a register on the desktop (an existing rule); `lesson_request.note` is free text and `apply_retention` does not reach it; a merge leaves `requested_by` on the absorbed membership, so that person cannot withdraw; a stand-in sees the *Mensagem* pill and is refused, since a stand-in does not own the turma.
