# POOLSE-73 · The complaints book and the operating regulation on every public page

> Part of the Poolse backlog. Conventions in [CONVENTIONS.md](./CONVENTIONS.md) apply to this ticket and are not repeated here.

**Type:** Feature · **Area:** Compliance / Public · **Priority:** Medium · **Depends on** POOLSE-71 (public water page), POOLSE-69 (public form) · **Roadmap** 7b.4

### PO — why this exists

Poolse now publishes two public pages per club: the water page and the sign-up form. Two duties
attach to them, and the research record is
[docs/research/public-notices-2026-10.md](../research/public-notices-2026-10.md).

- **The complaints book.** A private operator with a website must show access to the Livro de
  Reclamações Eletrónico "em local visível e de forma destacada" (DL 156/2005 art. 5.º-B n.º 2).
  A pool run directly by a câmara or freguesia is public administration (DL 135/99) and shows
  its own platform instead.
- **The operating regulation.** Portaria 454/2023 art. 46.º requires the owner or concessionaire
  to draw one up, send it to the câmara, register it on the IPDJ's iAP and make it available to
  users on request. Publishing the version in force on the public pages meets "on request" for
  anyone with the link.

**Not in scope:**
- The printed on-site sign (DL 156/2005 art. 3.º n.º 1 c).
- The DGC icon artwork, which must come from the official kit.
- A PDF upload of the regulation.
- Sending the regulation to the câmara or the iAP.

### BA — rules and data

- **The complaints regime is the club's.** It is either `private` (the default, linking to
  https://www.livroreclamacoes.pt/inicio) or `public_service`, which must name its own https
  platform address. The public platform's address is unverified, so the club supplies it. Owner
  and Admin set it.
- **The regulation is per facility and versioned by publication.**
  - A version has a body and the day it takes effect.
  - The version in force is the latest live one whose day has come, in the site's timezone.
  - A version is never edited: a correction is a new version, and one can be published ahead of
    the season.
  - Withdrawing a version archives it, and the previous one comes back.
  - Two live versions may not take effect on the same day.
  - Owner and Admin publish; every staff role reads.
- **Every public page carries both.**
  - The complaints link is bordered and prominent, with its own words.
  - The regulation in force sits behind a disclosure with its date. The sign-up form shows one
    per site.

### Acceptance criteria

1. A club chooses private or public service. The public pages link to the official Livro de
   Reclamações, or to the club's own platform, and a public service cannot be saved without one.
2. A facility's regulation is published in dated versions. The one in force is computed and
   never edited, and the history is kept.
3. The water page and the sign-up form show the complaints link prominently and the regulation
   in force with its date.
4. Families and students cannot read or write any of it through the API, and another club's
   facility is not found.
