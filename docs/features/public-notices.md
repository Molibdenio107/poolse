# The complaints book and the operating regulation

POOLSE-73, roadmap 7b.4. It lives on the facility page, on the **Regulamento** tab. The source
record is [`docs/research/public-notices-2026-10.md`](../research/public-notices-2026-10.md).

## On every public page

The water quality page (`/agua/<token>`) and the pre-registration form (`/inscricao/<slug>`)
both carry:

- **A prominent link to where a complaint goes.** It is a bordered link with its own words, as
  DL 156/2005 art. 5.º-B n.º 2 requires: "em local visível e de forma destacada".
  - **Private operator** (club, association, IPSS, hotel): it links to the Livro de Reclamações
    Eletrónico, https://www.livroreclamacoes.pt/inicio. This is the default.
  - **Public service** (a pool run directly by a câmara or junta): it links to the club's own
    platform under DL 135/99. Poolse has no address for it, so the club must give one.
  - It is not the DGC icon. The research says the icon's artwork must come from the official
    kit, and a redrawn one would be worse than a plain link.
- **The operating regulation in force** (Portaria 454/2023 art. 46.º), with the day it took
  effect, behind a disclosure. The form shows one per site; a site with none in force shows
  nothing rather than an empty box.

## The regulation

- It is per facility and versioned by publication. Each version has the day it takes effect.
- The version in force is the latest one whose day has come, in the site's timezone.
- **A version is never edited.** A correction is a new version, and the form starts from the
  text in force.
- A version can be published ahead of time, for example for the next season; it shows as
  *agendada*.
- *Retirar* withdraws a version published by mistake. It is archived and the previous one comes
  back. Two versions cannot take effect on the same day.
- The history lists every version with its day, who published it and when, so you can always
  answer "what did the rules say that day".

## Who can do what

| | Owner | Admin | Instructor, maintenance | Guardian, student |
|---|---|---|---|---|
| Read the regulation | ✓ | ✓ | ✓ | — |
| Publish or withdraw a version | ✓ | ✓ | — | — |
| Set the complaints regime | ✓ | ✓ | — | — |

## Not built

- The on-site sign "Este estabelecimento dispõe de livro de reclamações".
- A PDF of the regulation.
- Sending the regulation to the câmara or registering it on the IPDJ's iAP.
