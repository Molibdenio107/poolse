# POOLSE-184 · *Sugestões* on Custos: sentences the ledger can prove — each a rule with two numbers, or silence

> Part of the Poolse backlog. Conventions in [CONVENTIONS.md](./CONVENTIONS.md) apply to this ticket and are not repeated here.

**Type:** Feature · **Area:** Finance / Dashboards / AI · **Priority:** Low (post go-live) · **Depends on** [POOLSE-183](./POOLSE-183-custos-per-year-and-per-season.md), [POOLSE-28](./POOLSE-28-heating-cost-per-lesson-hour.md), 5.4b (weather history, `heating_degree_days`) · **Related** roadmap 6.3

### PO — why this exists

Rui, 05-11-2026: *"…and suggest improvements."*

With one reading a month there are twelve points a year, and `energy.md` already refuses to compute a correlation on that. A suggestion that is not a comparison the data can make is advice from nowhere, and an owner stops reading the panel the first time it says "consider a pool cover". So the first version is **rules**: each a function over the ledger that returns a sentence with its two numbers, or nothing. The AI-written version (6.3) can later read the same inputs and the same evidence, and say it better.

**Not in scope:**
- A free-text model answer with no rule behind it.
- Any rule needing interval data (tariff bands by time of day) until feeds exist (POOLSE-28's finer grain).
- Forecasts. A range forecast (month shares resampled under a temperature scenario) is its own ticket once two full seasons exist.

### BA — rules

1. **A suggestion is a rule**, in `@poolse/rules` (`cost-suggestions.ts`): `(ledger, context) → { key, sentence params, evidence: [{ label, value }] } | null`. The sentence is i18n; the evidence is shown beneath it, always.
2. **The first set**, each with its guard:
   - *Aquecimento custou X % mais que na época passada com temperaturas semelhantes* — guard: both windows have ≥ 8 months and HDD within 10 %; uses `heating_degree_days` (its first reader).
   - *A piscina B custa N× por hora de aula a piscina A* — guard: both tanks metered and ≥ 6 months taught; from POOLSE-28.
   - *N reparações no mesmo pedido/equipamento em 12 meses: X €* — guard: ≥ 3 service invoices on requests naming the same space or pool.
   - *Os meses de encerramento custaram X € de energia* — guard: a closure ≥ 7 days with a metered tank; says what the heating cost while nobody swam.
   - *O preço por kWh desta fatura está X % acima da média das últimas seis* — guard: ≥ 6 bills on the meter.
   - *Sem leituras no contador X há N dias — este mês é estimado* — guard: a sub-meter with a tariff and no reading for 45 days. Data quality first: the cheapest suggestion and the most useful at the start.
3. **Silence is the default.** A window with no rule firing shows *Nada a assinalar com os dados que existem* and which rules were skipped for lack of data, in words (*comparação com a época passada: precisa de 8 meses, tem 4*).
4. **Never a verdict.** A sentence states the difference; the owner decides. No "should", no "recomendamos".
5. **Owner and admin only**, on the *Custos* page, below the tiles.

### Dev notes

- Pure functions, unit-tested with fixtures per rule (fires / guard refuses / boundary). No API beyond `GET /costs/suggestions?ruler&window`, which runs the set and returns sentences with evidence.
- HDD: `weather_day.heating_degree_days` is stored by 5.4b and read nowhere today; the guard needs the site's weather history switched on (`WEATHER_HISTORY_ENABLED`) and says so when it is not.
- Trap: a rule that reads estimates and invoices together must say *inclui estimativas* in its evidence (POOLSE-182 rule 4).

### QA

1. Given two seasons with HDD within 10 % and heating +31 %, then the first rule fires with both HDD values in the evidence; given HDD 20 % apart, then it is skipped and the skip is listed.
2. Given tank B at 2,4× tank A per lesson hour, then the sentence names both figures and links to each tank's cost page.
3. Given 3 service invoices on the same pump in 12 months, then the repair rule fires with the sum.
4. Given a club with four months of data, then every rule is silent and the skipped list names each with its threshold.
5. Given an instructor's token → 403.
6. Both themes, snapshot.

### Acceptance criteria
- [ ] Six rules as pure functions, each tested fire / refuse / boundary.
- [ ] Evidence shown with every sentence; silence and skips in words.
- [ ] No verdict language; owner/admin only.
