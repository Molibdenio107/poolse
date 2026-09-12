# Features

What the app does, written functionality by functionality: what it does, who can do it, and
what rules apply. Short and factual — the argument for a decision belongs in
`docs/decisions.md`, the schema in `docs/data-model.md`, and the reasoning behind a piece of
code in the code.

One page per section of the app, named after the navigation, because that is how somebody
looks for it.

| Page | Covers |
|---|---|
| [navigation.md](navigation.md) | The home route, the menu, the shared page shell |
| [facilities.md](facilities.md) | Sites, tanks, lanes, capacity |
| [personal.md](personal.md) | One person and their own pool: the signup choice, and what the app hides |
| [spaces.md](spaces.md) | Espaços, the cleaning log, maintenance requests |
| [maintenance.md](maintenance.md) | Planned maintenance: recurring tasks, who they are for, and the record of every time one was done |
| [classes.md](classes.md) | Turmas, parcerias, the lane grid |
| [parcerias.md](parcerias.md) | Partnerships, their groups, the import and the export |
| [calendar.md](calendar.md) | The dated week, the hover card, cancelling a class |
| [billing.md](billing.md) | Price list, periodicities, what a student pays |
| [invoicing.md](invoicing.md) | The documents a fee line becomes: numbering, runs, credit notes, payments and chasing |
| [energy.md](energy.md) | Meters, what they read, the dial rule, and consumption by month |
| [platform.md](platform.md) | The operator's side: who may reach `/admin`, the narrow cross-tenant DB role, and the tenants table |

Pages are added as the sections they describe are touched. An absent page means nobody has
had reason to write one yet, not that the section is undocumented by policy.
