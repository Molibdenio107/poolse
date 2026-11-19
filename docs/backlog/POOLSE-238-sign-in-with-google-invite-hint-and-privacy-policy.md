# POOLSE-238 · Sign in with Google: the invitation says which address to use, and the privacy policy names Google

> Part of the Poolse backlog. Conventions in [CONVENTIONS.md](./CONVENTIONS.md) apply to this ticket and are not repeated here.

**Type:** Feature · **Area:** Identity / Invitations / Legal · **Priority:** Medium (pilot) · **Depends on** [POOLSE-129](./POOLSE-129-families-invited-from-the-student.md) (invitations), [POOLSE-227](./POOLSE-227-everyone-confirms-their-own-details-once-before-inicio.md) (the details step)

### PO — why this exists

Rui, 19-11-2026: Google sign-in is being switched on in Clerk. It is a dashboard setting only: Clerk's `<SignUp/>` and `<SignIn/>` show *Continuar com Google* by themselves. Two things around it are Poolse's to do.

- **The invitation.** An invitation is accepted by the account whose email it was sent to. Someone who taps *Continuar com Google* with a different Gmail lands signed in as the wrong person. The page has to say which address to use before they choose, and say plainly what to do when it happened anyway.
- **The privacy policy.** It lists what each provider receives, so Google, as an optional way in, belongs on it.

**Not in scope:**
- Configuring Google in Clerk. That is the dashboard, Rui's step, with custom OAuth credentials and basic scopes only.
- Apple sign-in: deferred to the native app (Rui, 19-11-2026).
- Any new endpoint or migration.
- Changing how an invitation is matched to an account.

### BA — rules

1. **Before choosing an account.** On `/join`, signed out, when the invitation names an address, a visible line above *Criar conta* / *Entrar* reads: *"Use o email para onde foi enviado o convite ({email}), também se entrar com o Google."* It is text, never a tooltip.
2. **Signed in as someone else.** The existing warning stays, worded as what to do: *"Está a entrar como {signedInAs}. O convite é para {invitedEmail}. Saia e entre com essa conta."* Its main button is **Sair**, which signs out and returns to the same invitation. *Aceitar com {current}* stays beside it, for a parent who wants their own login to hold a child's invitation (Rui, 29-10-2026).
3. **The privacy policy** (pt-PT and en) names Google as an **optional** sign-in provider. When a person chooses *Continuar com Google*, Poolse receives their name, email address and profile photo. Nothing is posted to their Google account, and they can use email and password instead. The *Última atualização* date moves to the day of the change.
4. **A name from Google reaches the details step.** Clerk fills `first_name` / `last_name` from Google. Both of our paths copy them into `app_user` (`refreshFromClerk` on first sight, the `user.created` / `user.updated` webhook later), so *Os seus dados* opens prefilled. No code depends on the provider.

### Dev notes

- `apps/web/src/app/(app)/join/accept-form.tsx`: the line in the signed-out branch (rule 1). New keys `join.useInvitedEmail`; the reworded `join.mismatch`; `join.signOutAndContinue` becomes *Sair*.
- `legal.privacy.sections.processors.body`: a list item after Clerk; `legal.updated` takes the new date. `docs/features/legal.md` lists Google among the providers.
- Rule 4 needs no code. The test harness never calls Clerk, so it cannot hold a user with a Google external account. It is a manual QA step (QA 3).
- `docs/decisions.md`: *"Sign in with Google enabled (Clerk, custom OAuth credentials, basic scopes only). Apple sign-in deferred to the native app."*

### QA

1. Given an invitation to ana@example.com, signed out, when /join opens, then the line names ana@example.com above *Criar conta* and *Entrar*.
2. Given that invitation and a session as other@gmail.com, when /join opens, then the warning reads *Está a entrar como other@gmail.com. O convite é para ana@example.com. Saia e entre com essa conta.* **Sair** signs out and returns to the same invitation. *Aceitar com other@gmail.com* is still offered.
3. **Manual, once Google is on in dev Clerk:** sign up with *Continuar com Google*, create a club, and step 1 *Os seus dados* shows the Google account's first and last name.
4. Given an invitation to the address you are signed in with, then there is no warning and *Aceitar* joins.
5. `/privacidade` and `/en/privacy` list Google as optional, with the three things received, and show the new date.
6. `i18n:check` and `pt:check` green. Light and dark: the line and the warning are text, the warning keeps its icon, and nothing relies on colour alone.

### Acceptance criteria

- [ ] Rule 1 line on `/join` when the invitation names an address (pt-PT + en).
- [ ] Rule 2 warning text and **Sair**; *Aceitar com…* kept.
- [ ] Privacy policy in both languages names Google as optional, with the date moved; `docs/features/legal.md` updated.
- [ ] Rule 4 confirmed by reading the code paths, and QA 3 listed as a manual step.
- [ ] `docs/decisions.md` line.
- [ ] `i18n:check`, `pt:check` green; no new endpoint, no migration.
