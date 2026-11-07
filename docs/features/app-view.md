# See the app as a real person

POOLSE-188. An owner, an admin or Poolse support picks a person of the club and sees that
person's phone app, read-only.

## Who can do it

| Reader | May view | Sees faces | Reads *Vistas da app* |
|---|---|---|---|
| Owner | Anybody with a login, in the club | Yes | Yes, every view |
| Admin | Anybody with a login except the Owner | Yes | No |
| Poolse support | The same as an Admin, and only inside a live grant, with a reason | No, logo and initials | No; Rui reads support views on `/admin` |
| Instructor, maintenance, family | Nobody | | |

Only people with a login can be picked. A student with no login is seen through their guardian.

## The reader's own home is not a view

An owner or admin who also holds another role sees that home first on *Como quer entrar?*: an
Owner with `instructor` gets *As minhas aulas*. That is their own account working normally: real
saves, no time limit, no banner, and the desktop untouched. It is remembered per device, so one
person can be Owner on the computer and teacher on the phone at once, which is the pilot
(Rui, 07-11-2026). To set it up, give the Owner the Professor role and put them on their turmas as
instructor. The phone shows only the classes they teach, as for any teacher.

## How it works

1. The first time an owner, an admin or support opens `/app`, they get *Como quer entrar?*:
   *Backoffice*, *Família*, *Professor*, *Manutenção*. *Backoffice* is remembered per person on
   that device. *Ver a app como…* in the avatar menu and on *Perfil* reopens it.
2. Any other choice asks for a person. A view opens at once and lasts at most one hour.
3. A banner on every screen says who is being viewed, with *Sair*.
4. While a view is open the backoffice sends the reader back to the app, on any device.

## Rules

- **The `app_view` row decides.** `resolve_memberships` reads it on every request; there is no
  cookie and no header. Everybody is re-checked each time: the reader still holds their role,
  the person is still active and holds the home's role, and a support view belongs to its grant.
- **Only the chosen home's roles apply.** An instructor who is also an Admin is viewed as an
  instructor.
- **Every write is refused** with 403 `viewing_as`. *Sair* and `/me/preferences` are the exceptions.
- **What a view reads is a list**, `READS` in `apps/api/src/tenant/app-view.ts`, exact paths and
  GET only. Anything else answers 403 `viewing_as`, and a test fails if a route opens that nobody
  chose. Medical leave, the FPN form's data and the boletim are left off on purpose.
- **Files:** the logo for everybody, a person's photo for an owner or admin, nothing else. Support
  gets no photo, an instructor's Clerk picture included, and no personal aviso.
- **The documents list** offers no download and no sending under a view, and leaves the medical exam out: its state can say *unfit*.
- `POST /organizations`, `POST /join` and `POST /me/sessions/:id/revoke` stay open: they only touch the reader's own account.
- **Recorded:** `app_view.started` and `app_view.ended`, plus one `app_view.read` per request,
  written before the read and refusing it if it cannot be written. The audit log names the real
  person, and the read row holds the route pattern, never the URL.
- **The person viewed is not told** (Rui, 06-11-2026). A view of a student also shows on that
  student's Atividade, for the Owner only.
- `app_view` is a record: only `ended_at` can change, and it cannot be deleted. A view that ran
  out has no `ended_at` and reads as ended at `expires_at`.

## Known limits

An instructor's lesson opens in the backoffice, so under a view the link returns to the app.

The privacy notice must say that a club and Poolse support can do this (`docs/deploy.md`).
