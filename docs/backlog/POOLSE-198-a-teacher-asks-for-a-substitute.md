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
