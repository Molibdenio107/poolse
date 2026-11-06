# POOLSE-176 · *Perfil* reads first and edits second; language, theme and the club's messages fold into *Definições*; the club's logo takes the corner

> Part of the Poolse backlog. Conventions in [CONVENTIONS.md](./CONVENTIONS.md) apply to this ticket and are not repeated here.

**Type:** Feature · **Area:** Mobile app / Profile · **Priority:** Medium (pilot) · **Depends on** [POOLSE-140](./POOLSE-140-app-design-pass.md), [POOLSE-136](./POOLSE-136-the-app-phone-shell.md)

### PO — why this exists

Rui, 05-11-2026, three remarks on the same screen: *"'my profile' when clicked, it should not display right away the student details, they should be hidden and then the student clicks 'Edit details' or similar"*; *"'idiom' 'tema' 'mensagens do clube' should be discreet on the mobile app, fix it. other apps do not have this info right away"*; and on the header, *"the Mobile app should display the club logo instead of the profile icon on the top right corner, since we already have the profile menu"*.

*Perfil* today (Rui's mockup B, 31-10-2026) opens straight into `ProfileForm` — four inputs and a Save — with *Idioma*, *Tema*, push and the club's email opt-out laid out beneath it. On a phone that is a settings page pretending to be a profile. The common shape is the one Rui describes: a card that *shows* who you are, one button to edit, and the preferences one level down. The corner photo duplicates the diamond tab and costs the header the one thing a family recognises first — their club.

**Not in scope:**
- What the profile edits (name, birth date, phone go where they went — see POOLSE-177 for the bug).
- The backoffice's `/dashboard/profile` and `UserMenu` on desktop — unchanged.
- A logo upload: `organization.logo_file_id` exists (POOLSE-104). A club without one shows its initials.

### As built (05-11-2026) — wins over what follows

- **No `logoUrl` and no signed address.** CLAUDE.md settled that a file is read only through the app, so the corner uses `/shell`'s `logoFileId` at `/files/<id>`, as the sidebar does. The `logo` purpose is readable by anyone in the club.
- **App mode's layout did not read `/shell`.** It does now, for the corner; it read `/me` alone before.
- **The photo's upload moved into the sheet**, because rule 1 says nothing on *Perfil* is an input.
- **Reverses Rui's 31-10-2026 photo in the corner,** as his note on this ticket asks.

### BA — rules

1. ***Perfil* opens read-only.** A centred photo, the name at 700, then birth date and phone as two labelled lines (a missing one says *—*). One button, *Editar dados*, pill, full width. Nothing on this screen is an input.
2. ***Editar dados*** opens the existing form as a bottom sheet (`placement="sheet"`, POOLSE-136), with the same `ProfileForm` and the same save; *Guardar* closes the sheet and the card re-reads. *Cancelar* closes without saving. On a laptop the sheet is centred.
3. **One row, *Definições***, below the card: it opens `/app/perfil/definicoes`, a screen deeper in (its own *Voltar*, no tab bar) holding, in this order: *Idioma*, *Tema*, *Avisos neste telemóvel* (push), *Mensagens do clube por email*. Each keeps its present control; nothing about how they save changes.
4. ***Áreas*** (the switcher, *Abrir o backoffice*), the devices and *Terminar sessão* stay on *Perfil*, below *Definições*, in that order — a parent-instructor must never be locked in app mode.
5. **The corner is the club.** The header's top-right shows the club's logo (`organization.logo_file_id`, through the same signed read the invoice uses), 32 px, round, with the club's name as the accessible label; without a logo, the club's initials on the app fill. **It is not a link**: the diamond tab is the one way to *Perfil*. The club's name stays as the header's text on tab screens.
6. **A second club** for somebody in several: the corner shows the active club, and switching stays where it is (*Áreas*).

### Dev notes

- `app/perfil/page.tsx`: the read-only card is a server component; the sheet is a client island wrapping `ProfileForm` (keep `withPreferences={false}`). `/app/perfil/conta` keeps redirecting to `/app/perfil`.
- New route `app/perfil/definicoes/page.tsx` taking `PreferenceRows`, `PushCard`, `MessagePreferenceCard` as they are; `app-frame.tsx` already treats a non-tab path as "deeper in" (no bar, *Voltar*).
- `app-frame.tsx` `ProfileCorner` → `ClubCorner`: the frame already receives the organisation from the layout's `/shell` read (POOLSE-172); add `logoUrl` to `/shell` rather than a new call. The logo is a signed URL with the same TTL as elsewhere; never the raw storage key.
- Trap (POOLSE-99): the theme toggle used to not apply because the provider inherited the server theme; moving the row one screen down must not re-break it — test 4.
- i18n: `app.profile.edit`, `app.profile.settings`, `app.profile.clubLogo` in both files.

### QA

1. Given *Perfil*, then no input is on the screen; *Editar dados* opens the sheet with the current values; saving closes it and the card shows the new phone.
2. Given *Definições*, then the four rows are there and the tab bar is not; *Voltar* returns to *Perfil* with the diamond current.
3. Given the header on *Início*, then the corner is the club's logo with the club's name as its label and is not focusable as a link; given a club without a logo, then its initials.
4. Given dark mode chosen in *Definições*, when the family returns to *Início*, then it is dark (POOLSE-99 regression).
5. Given a staff member in app mode, then *Áreas* with *Abrir o backoffice* is still on *Perfil*.
6. Given the raw `/shell` JSON, then `logoUrl` is a signed URL or null, never a storage key.
7. Both themes, snapshot of *Perfil* and the header.

### Acceptance criteria
- [x] *Perfil* is read-only with one *Editar dados* that opens a sheet.
- [x] Language, theme, push and club messages live on *Definições*, one row away.
- [x] The header's corner is the club's logo or initials, not a link; the diamond tab is the way to *Perfil*.
- [x] Nothing changes on `/dashboard/profile`; QA 1–7 green.
