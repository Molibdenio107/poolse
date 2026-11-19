# POOLSE-231 · The water-analysis threshold on a site's Geral says what it does, in words a club uses

> Part of the Poolse backlog. Conventions in [CONVENTIONS.md](./CONVENTIONS.md) apply to this ticket and are not repeated here.

**Type:** Sweep · **Area:** Instalações / Water · **Priority:** Medium (pilot) · **Depends on** —

### PO — why this exists

Rui, 19-11-2026, UX polish batch: the setting reads as jargon. *"Idade máxima da última análise (horas)"* asks the reader to think in "the age of an analysis". What the club means is "analyse the water at least every N hours". The feature stays as it is. It is what puts a tank on the Painel's *Água por analisar* card (`management.repository.ts` reads `facility.water_analysis_max_age_hours`). Only the words change.

**Not in scope:**
- Any change to the column, the endpoint, the check or the Painel card.
- Moving the setting, or adding it to the setup wizard.

### BA — rules

1. **Label** (`facilities.waterThreshold.label`): *Analisar a água pelo menos a cada __ horas*. The field stays a number of hours. The words around it make it a sentence, and the field's accessible name is the whole sentence.
2. **Visible sentence under it** (`facilities.waterThreshold.hint`, never a tooltip): *Se passar este tempo sem análise, o tanque aparece em «Água por analisar» no Painel. Vazio: não é verificado.* The brief said *no Início*, but the signal is on the **Painel**, not Início (checked 19-11-2026). **Painel only** (Rui, 19-11-2026): the words follow what the product does, and nothing moves to Início.
3. **Read-only variants**, for a reader who may not edit:
   - `notSet`: *Não está definido de quanto em quanto tempo se analisa a água nesta instalação.*
   - `value`: *A água é analisada pelo menos a cada {hours} horas.* (ICU plural for 1 hora.)
4. English mirrors each: *Test the water at least every __ hours* / *If this long passes with no test, the tank shows under "Water to test" on the Dashboard. Empty: not checked.* / *How often the water is tested here is not set.* / *The water is tested at least every {hours, plural, one {# hour} other {# hours}}.*

### Dev notes

- `facilities/[facilityId]/water-threshold-form.tsx` and the `facilities.waterThreshold.*` keys only. The label sentence with a field inside it: render *Analisar a água pelo menos a cada*, the `TextField` (`inputMode="numeric"`, its label visually hidden but the full sentence for a screen reader) and *horas* on one line that wraps on a phone. Don't build a string by concatenation (CONVENTIONS, i18n). Use two keys, `labelBefore` and `labelAfter`, plus the full `label` for the accessible name.
- `pnpm pt:check` and `i18n:check`. No schema change, no API change.

### QA

1. Given an owner on a site's Geral → *Análises da água*, the label reads as one sentence and the hint sentence is visible without hovering.
2. Given a value of 1, the read-only text says *1 hora*; given 24, *24 horas*; given empty, the *não está definido* sentence.
3. Given an instructor (read-only), they see the read-only sentence and no field.
4. Given a phone width (360 px), the sentence wraps with the field on its own line and no sideways scroll.
5. Both themes, with the hint at the muted ink's contrast.
6. Cross-tenant and wrong role: unchanged endpoint, covered by the existing tests. This ticket adds no route.

### Acceptance criteria
- [x] New label, hint and read-only sentences in pt-PT and en; `pt:check` green.
- [x] Field's accessible name is the whole sentence.
- [x] The sentence names the Painel (rule 2).
