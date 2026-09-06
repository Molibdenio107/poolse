# Espaços

The non-pool parts of a facility — balneários, sala de máquinas, arrecadação, receção, parque
de estacionamento — with a cleaning log and a list of open issues on each.

Schema in [../data-model.md](../data-model.md), "Espaços, cleaning and issues". The arguments
are in [../decisions.md](../decisions.md).

## Where it lives

**Two places, one component.** Espaços appears on **Instalações**, inside each site's card
directly under that site's tanks, and again on a **site's own page** below Piscinas. Same data
and same controls; only the framing differs — a block with a rule above it inside a card, a
section of its own on the site page. `SpacesPanel` takes a `variant` and nothing else changes,
because a second copy is how two screens start disagreeing about what a space is.

**The section starts collapsed**, on both screens, with a summary in its header: how many
spaces, how many overdue, how many open issues. The two things worth acting on stay legible
without opening anything, which is what makes closing it safe.

One row per space showing its name, its type, when it was last cleaned as a relative time
("Limpo há 2 dias") and how many issues are open. An open issue is marked in amber with its
own icon — a space can be spotless and still have a broken shower, and that is not the red
that overdue cleaning earns. The name is the link through to the detail
screen; there is no separate "ver detalhes", matching the Piscinas and Instalações lists.

Instalações fetches one space list per site, in parallel. That is a loop over an endpoint,
which is usually wrong; here it is right, because a licence bounds a club to the sites it has
paid for — one for most, two or three for a câmara — and folding it into `/facilities` would
put every site's cleaning state behind the request that draws the page.

**Space detail** at `/dashboard/facilities/spaces/{id}`: the header, "Marcar como limpo", the
cleaning history, then the issues.

## What a space is

A name, a type (Balneário, Técnico, Arrecadação, Receção, Exterior, Outro), an optional
description, and an optional cleaning interval in hours.

Names are unique per site, accent- and case-insensitively — "Balneário" and "balneario" are
one room. Archiving a space frees its name.

**In service, or out of service.** A space out of service is still listed and still openable,
and it is never reported as overdue. A balneário shut for building works is not a cleaning
failure, and a warning that appears on one is a warning operators learn to ignore.

## Overdue

A space is overdue when the time since its last cleaning exceeds its interval.

- **No interval means never overdue.** Null is "no schedule", not "overdue immediately".
- **A space with an interval and no cleaning at all is overdue.** An absence of history is not
  evidence of cleanliness.
- **Out of service is never overdue**, as above.
- **A deleted cleaning did not happen.** Removing the only entry puts the space back to
  overdue.

Overdue is computed when the list is read. Nothing is stored and nothing runs in the
background.

The warning is an icon and words together, never colour alone.

## Cleaning

**"Marcar como limpo" is one tap.** The server fills in who and when; neither can be supplied
by the client. A note is available behind a secondary control and is never required.

The history is reverse-chronological and paginated: "Limpo por {nome} às {hora} do dia
{data}", with the note where there is one.

**There is no edit.** An entry is a claim about a moment, and editing one rewrites what a
colleague said they did. A mistake is deleted, which is Owner/Admin only.

## Issues

An issue is an **Avaria** or a **Reposição**, with a description. Open ones are listed first;
resolved ones are collapsed below and can be expanded.

Each shows its type, description, who reported it and when. A resolved one also shows who
resolved it, when, and the resolution note if there is one.

Resolving an issue somebody else has already resolved is refused rather than silently
re-stamped — the second person is told, instead of quietly overwriting who fixed it.

## Who can do what

| Action | Owner | Admin | Instructor | Maintenance | Student / Encarregado |
|---|:-:|:-:|:-:|:-:|:-:|
| See spaces and their history | ✓ | ✓ | ✓ | ✓ | ✓ |
| Log a cleaning | ✓ | ✓ | ✓ | ✓ | — |
| Report an issue | ✓ | ✓ | ✓ | ✓ | — |
| Resolve an issue | ✓ | ✓ | — | ✓ | — |
| Add or edit a space | ✓ | ✓ | — | — | — |
| Delete a space, cleaning or issue | ✓ | ✓ | — | — | — |

Every one of these is enforced server-side. The screen hides controls it knows would be
refused, using the same answer the guards use — hiding a control is never the control.

**An instructor may report and not resolve.** Reporting is noticing; resolving is a judgement
that the work was done.

## Inventory locations

Inventory items used to carry a free-text location. Those became spaces: one per distinct
location per site, typed `Outro`, and each item now points at one. Items with no location
still have none — no space was invented for them.

The original text column is still in place so the result can be checked. Dropping it is a
separate change.

## Not in this slice

- A QR code per espaço linking straight to "Marcar como limpo".
- A Reposição decrementing inventory stock.
- Notifications or emails when something goes overdue.
- Dropping `inventory_item.location`.
