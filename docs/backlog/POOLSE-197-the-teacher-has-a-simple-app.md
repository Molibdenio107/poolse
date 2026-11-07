# POOLSE-197 · A teacher's phone is a simple everyday app: their next class, their lessons, and one lesson screen

> Part of the Poolse backlog. Conventions in [CONVENTIONS.md](./CONVENTIONS.md) apply to this ticket and are not repeated here.

**Type:** Feature · **Area:** Mobile app / Classes · **Priority:** High (pre go-live) · **Depends on** [POOLSE-90](./POOLSE-90-the-app-agenda-per-role.md), [POOLSE-136](./POOLSE-136-the-app-phone-shell.md), [POOLSE-195](./POOLSE-195-desafio-in-the-training-plan.md) · **Unblocks** POOLSE-198, 199, 200

### PO — why this exists

Rui, 07-11-2026: *"the mobile view for teachers should be similar to the student view. A simple basic everyday functionality. For more in depth things the teacher access the desktop app."*

Today a teacher's lesson opens the backoffice page squeezed onto a phone. The pilot is one person teaching on the phone while running the club on the desktop, so this is what the pilot uses every day.

**Not in scope:** turma changes, copying plans between weeks, the calendar's grid, moving a lesson. Those stay on the desktop.

### BA — rules

1. **Tabs:** *Início*, *Aulas*, *Perfil*.
2. **Início** shows the teacher's next class as the student's does, then one line for any register still owed, then the staff notes (Rui).
3. **Aulas** is a calendar like the family's: a week strip and the teacher's lessons, with past lessons reachable to mark late. A stand-in sees the lesson they cover, and the regular teacher does not.
4. **One lesson screen,** in the app, never the backoffice: time, turma, tank; who is enrolled and who is coming, with photos; marking attendance by tap; the training plan and the Desafio as short text, editable (Rui).
5. Minors follow the same rules a teacher already has: this is their own class, so names and photos show, within photo consent.
6. Every read and write uses the routes that exist. A teacher still reaches only their own lessons.

### Dev notes

Reuse `GET /app/teaching`, `GET` and `POST /sessions/:id/attendance`, `GET` and `PUT /sessions/:id/plan`, `PUT /sessions/:id/challenge`. Add a windowed teacher agenda beside `agendaWindowAllowed`. New screens under `/app/aulas`. `tabFor` in `lib/app-hats.ts` gains them. Owner with the Professor role reaches this as their own home (POOLSE-188 rule 2a). A view's list in `tenant/app-view.ts` needs any new read.

### QA

1. Given a teacher with a lesson today, then Início shows it; with an unmarked past lesson, then one line says so.
2. Given Aulas, when the week changes, then that week's lessons show; another teacher's do not.
3. Given a stand-in, then the lesson shows for them and not for the regular teacher.
4. Given the lesson screen, when a student is marked, then the register records it and survives a reload.
5. Given a plan and a Desafio typed on the phone, then the family app and the desktop show them.
6. Given another teacher's lesson id, then 404 or 403.
7. Both themes, on a phone.

### Acceptance criteria
- [ ] Rules 1 to 6, with a role-probe line for any new route.
- [ ] QA 1 to 7.
