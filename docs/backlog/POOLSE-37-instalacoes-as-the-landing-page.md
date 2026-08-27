# POOLSE-37 · Instalações as the landing page

> Part of the Poolse backlog. Conventions in [CONVENTIONS.md](./CONVENTIONS.md) apply to this ticket and are not repeated here.

**Type:** Improvement · **Area:** Navigation / Auth · **Priority:** Medium
**Depends on:** POOLSE-17 (roles are assignments on a Person)

### PO — why this exists
After signing in, users land somewhere generic and then navigate to the thing they actually came for.
Instalações is where an Owner or Admin starts their day, so that is where the app should open. But
landing every role there would drop an instructor or a student on a page they cannot open, so the
landing page is chosen by role.
**Not in scope:** building any new dashboard, or changing what Instalações itself contains.

### BA — rules and data
- Landing destination by role: **Owner, Admin → Instalações**; **Instructor → the turmas they teach**; **Maintenance → their tasks**; **Student, Encarregado de Educação → their own area**.
- A Person holding several roles lands on the destination of their **strongest role** (Owner → Admin → Instructor → Maintenance → EE → Student), matching the invite-matrix rule in C4.
- A user who was sent a deep link and had to sign in first goes to **that link**, not the landing page. The landing rule only applies to a bare sign-in.
- If the landing destination for a role is not built yet, fall back to the next destination the user can actually open, and never to a permission error.
- The landing route is not a redirect the user can get stuck in: hitting the app root when already signed in resolves once, without a loop.
- Signing out and back in returns to the landing page, not to the last visited page.
- **Open:** should the landing page be a per-user preference later ("open on…"), or stay derived from role only?

### Dev — implementation notes
- One `resolveLandingRoute(person)` helper, consulted by the post-sign-in redirect and by the authenticated root route. Do not scatter the rule across middleware and page components.
- Clerk's post-sign-in redirect should hand off to an app route that resolves the destination server-side, so the decision is made where the roles are known rather than after a client render.
- The deep-link case is Clerk's `redirect_url`; preserve it and only fall through to the landing rule when it is absent.
- Guard against the fallback chain resolving to a route the user cannot open — derive it from the same permission helper the navigation uses, not a hardcoded list.
- Most likely to be got wrong: the redirect loop when the landing route itself requires a permission check that redirects back to root.

### QA — test scenarios
- **37.1** Given an Owner / When they sign in / Then they land on Instalações.
- **37.2** Given an Admin / When they sign in / Then they land on Instalações.
- **37.3** Given an Instructor / When they sign in / Then they land on their turmas, not Instalações.
- **37.4** Given a Maintenance user / When they sign in / Then they land on their tasks.
- **37.5** Given a Student / When they sign in / Then they land in their own area and never sees Instalações.
- **37.6** Given a Person who is both Instructor and Admin / When they sign in / Then they land on Instalações, the stronger role winning.
- **37.7** Given a signed-out user who opens a deep link to a turma / When they sign in / Then they arrive at that turma, not the landing page.
- **37.8** Given a signed-in user / When they navigate to the app root / Then they are resolved to their landing page once, with no redirect loop.
- **37.9** Given an Instructor whose turmas page is not yet built / When they sign in / Then they land on a page they can open, never on a permission error.
- **37.10** Given a user who signs out from deep inside the app / When they sign in again / Then they land on their landing page, not where they left off.
- **37.11** Given any role / When the landing page renders / Then its strings are present in pt-PT and en.

### Acceptance criteria

1. After sign-in, Owner and Admin land on **Instalações**.
2. Other roles land on the destination appropriate to them: Instructor → their turmas, Maintenance → their tasks, Student and Encarregado de Educação → their own area.
3. A Person with several roles lands on the destination of their strongest role.
4. A deep link that triggered the sign-in wins over the landing rule.
5. No role ever lands on a page they lack permission to open.
6. Navigating to the authenticated root resolves to the landing page without a redirect loop.
7. The rule lives in one shared helper, used by both the post-sign-in redirect and the root route.
