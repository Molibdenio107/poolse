# POOLSE-72 · The national water reference, and grading a lab result

> Part of the Poolse backlog. Conventions in [CONVENTIONS.md](./CONVENTIONS.md) apply to this ticket and are not repeated here.

**Type:** Feature · **Area:** Maintenance / Compliance · **Priority:** High — every pool is judged by these numbers today · **Depends on** slice 4.2 (bands, excursions, alerts), POOLSE-71 (public page) · **Roadmap** 7b.3

### PO — why this exists

Every reading in Poolse is judged against `HEALTHY` in `@poolse/rules` unless a club has set its
own band. **Those values cite nothing, and none of them matches a Portuguese source.**

- **pH:** Poolse uses 7.2–7.6. NP 4542 allows 6.5–8.0, and prefers 7.0–7.4 with chlorine.
- **Free chlorine:** Poolse uses a flat 0.5–2. Every source makes the range depend on pH.
- **Temperature:** Poolse uses 25–29 °C. NP 4542 sets a different band for each use of the tank.
- **Total alkalinity:** Poolse uses 80–120. NP 4542 allows 75–250.

The alert email, the pool's page and the public water page all run off those numbers, so the
same wrong value reaches all three.

A club also receives a laboratory report every two weeks to a month. A health authority grades
that report as *conforme*, *conforme condicionada* or *não conforme*. Poolse holds none of the
microbiology a lab measures and gives no grade, so the result an inspector actually asks about
lives on paper beside the app.

The research is in [docs/research/water-reference-2026-10.md](../research/water-reference-2026-10.md).
It covers the three documents in force, the values from their original text, the grading rule
and what is still unverified. **This ticket's values come from that file and nowhere else.**

**Not in scope:**
- DR 5/97 as a second regime for hotel pools. A hotel overrides its bands per pool, as any club
  can today.
- Supply-water values, and the limits measured relative to them (conductivity, chlorides,
  oxidability, TOC, nitrates).
- Legionella, THM and metals.
- Bromine or ozone as the disinfectant.
- The printable sanitary register (POOLSE-75).
- Any change to how often anybody must measure.

### BA — rules and data

**The reference is NP 4542:2017** (decisions, 13-10-2026), the standard health authorities grade
samples with today. `HEALTHY` is replaced by it, cited by quadro in the code. A club's own
`pool_metric_range` still wins, exactly as now. A pool with no override moves to the new values
the moment this ships, which is the point.

**Free chlorine depends on pH.** This is the one new band shape. Every other band is a fixed
range.

| Tank (`pool.kind`) | pH ≤ 7.4 | pH > 7.4 |
|---|---|---|
| Covered (`indoor`) | 0.5–1.2 | 1.0–2.0 |
| Open-air (`outdoor`) | 0.8–1.5 | 1.5–3.0 |

- **The split at 7.4 is Poolse's decision.** NP 4542 leaves 7.4–7.5 uncovered for covered tanks.
- A free-chlorine reading is judged by the pH **in the same analysis**.
- With no pH in that analysis, the reading is judged against the union of both bands: 0.5–2.0
  covered, 0.8–3.0 open-air. That is the widest the standard allows, and the screen says the
  judgement was made without a pH.

**The other national bands:**

| Metric | NP 4542 band | Notes |
|---|---|---|
| pH | 6.5–8.0 | Quadro 2 limit |
| Combined chlorine | ≤ 0.5 | Total chlorine may be at most free chlorine + 0.5 |
| Cyanuric acid | ≤ 100 | Only meaningful with stabilised chlorine; it stays judged, as the club's kit reports it |
| Total alkalinity | 75–250 | |
| Turbidity | ≤ 1.5 NTU | |
| Calcium hardness, salt | none | No national band; not judged unless the club sets one |

**Temperature comes from what the tank is for** (decisions, 13-10-2026). This is a new
`pool.use`; unset means temperature is not judged rather than guessed.

| `pool.use` | Band (°C) |
|---|---|
| `sport` (swimming, water polo, synchronised) | 24–26 |
| `diving` | 26–28 |
| `learning` (learning, recreation, multi-use) | 26–28 |
| `children` (maintenance and children's) | 28–32 |
| `hydrotherapy` | 30–36 |

For an outdoor heated tank, NP 4542's 24–28 replaces the use's band.

**A lab result is its own record.** It is not a kit reading. It holds:
- the laboratory and the report reference;
- the sample date and time;
- the sample point (surface or below it, plus the club's own label);
- the seven microbiological parameters;
- any physico-chemical values the lab measured.

**Microbiological limits** (NP 4542 Quadro 3, in CFU; the same in all three sources):

| Parameter | Recommended value (VR) | Limit value (VL) |
|---|---|---|
| Colonies at 37 °C (/mL) | ≤ 100 | — |
| Coliform bacteria (/100 mL) | 0 | 10 |
| *E. coli* (/100 mL) | — | 0 |
| Enterococci (/100 mL) | — | 0 |
| *Pseudomonas aeruginosa* (/100 mL) | — | 0 |
| Coagulase-positive *Staphylococcus* (/100 mL) | — | 0 |
| Total *Staphylococcus* (/100 mL) | ≤ 20 | — |

**The grade is NP 4542 §4.4, over what Poolse holds** (decisions, 13-10-2026):

- **Não conforme:** any Quadro 3 limit fails, or any Quadro 2 limit fails (pH, free and
  combined chlorine, cyanuric acid).
- **Conforme condicionada:** every Quadro 3 limit passes, but a Quadro 3 recommended value
  fails, or a Quadro 1 criterion Poolse holds fails (turbidity, total alkalinity).
- **Conforme:** everything held passes.
- **A parameter the lab did not report is not judged.** The grade states which parameters it
  covered. A report with no microbiology is graded on chemistry alone and says so; it is never
  presented as a full grade.

**The grade is derived, never stored.** It is computed once, in `@poolse/rules`, from the stored
values: the screen and the alert read the same function, so they cannot disagree. A lab result
is corrected by archiving it and recording it again, like an analysis.

**A não conforme result raises the existing water alert.** It uses the same recipients, the same
`ALERT_WINDOW_HOURS` window on the sample date and the same honest *recorded, not sent*. NP 4542
lets the health authority close the tank, and the operator must know that the same day.

**Owner, Admin and Maintenance** record and read lab results; that is the same set that records
analyses. The public water page shows the latest grade and its date, and nothing else from the
lab report.

### Dev — schema, API, where it goes

- **`@poolse/rules`:**
  - Replace `HEALTHY` with the NP 4542 set, cited by quadro.
  - Add `freeChlorineBand(kind, ph)` and `temperatureBand(use, kind)`.
  - Widen `resolveBands` to take the pool's kind and use, and the analysis's pH.
  - Add `gradeLabResult()`, which returns the grade, the parameters it covered and each failure
    with its limit, so the sentence needs no recomputation.
  - Pure functions, tested beside the existing water tests.
- **Migration:**
  - `pool.use` (enum, nullable).
  - `lab_result` (tenant-scoped, RLS, composite FKs to pool and recorder, `archived_at`).
  - `lab_result_value`, keyed `(lab_result_id, parameter)`, with `numeric` values, a unit and a
    `lab_parameter` enum for the seven organisms plus the chemistry `pool_metric` already names.
  - A trigger refuses an organism count below zero.
- **API:** record, list and archive a lab result under the pool, on the analyses controller's
  roles.
  - The alert reuses `pool_analysis_alert`'s path, generalised or with a sibling row. Pick the
    one that keeps "who was told" a single query.
  - `public_water_page()` gains `latestLabGrade` + `sampledAt`, and its key list is
    re-asserted.
- **Web:**
  - The pool's water tab gets a *Análises laboratoriais* section with the grade chip (words and
    an icon, never colour alone), the failures in words, and what was not covered.
  - The pool form gets *Utilização*.
  - The lab-report parser (`AnalysisReportParser`) learns the seven organisms, so a PDF fills
    them on the preview.

**What will be got wrong:**
- Judging free chlorine without the same analysis's pH, or with the latest pH from another
  visit.
- Treating an unreported parameter as a pass; it is "not covered", never "conforme".
- Recomputing the grade in the web app.
- Letting `pool.use` null fall back to a temperature band.
- Forgetting that the public page's key list is asserted by a test.

### QA — test scenarios

1. **Given** a covered pool with no override, **when** an analysis records pH 7.2 and free
   chlorine 1.5, **then** chlorine is high against 1.2. **With** pH 7.6 the same 1.5 is inside
   1.0–2.0.
2. **Given** an open-air pool, **when** pH 7.6 and free chlorine 2.5, **then** it is inside
   1.5–3.0.
3. **Given** free chlorine with no pH in the analysis, **then** it is judged against 0.5–2.0
   (covered) and the screen says no pH was measured.
4. **Given** `pool.use` unset, **then** temperature is not judged. **Given** `children`, **then**
   27 °C is low against 28–32.
5. **Given** a club override on pH, **then** it still wins over NP 4542, and a pool with no
   override moves to 6.5–8.0.
6. **Given** a lab result with *E. coli* 1/100 mL, **then** não conforme, naming *E. coli* and
   its limit 0.
7. **Given** coliforms 5 and all limits met, **then** conforme condicionada (coliforms over the
   recommended 0).
8. **Given** a lab result with chemistry only, **then** the grade covers chemistry and says
   microbiology was not reported.
9. **Given** a não conforme result sampled within 48 h, **then** one alert is recorded with its
   recipients. An old one imported later records nothing.
10. **Given** an Instructor or a guardian, **when** they record or read a lab result, **then**
    403. Club B's lab result is not found from Club A.
11. **Given** the public page, **then** it carries the latest grade and date and no other lab
    field, and its key list test is updated.

### Acceptance criteria

1. Readings with no club band are judged by NP 4542:2017. Each value is cited by quadro in
   `@poolse/rules`, and free chlorine follows the same analysis's pH and the tank's kind.
2. `pool.use` sets the temperature band, and an unset use judges no temperature.
3. A lab result records the microbiology, the chemistry it carries, the laboratory and the
   sample point.
4. Its grade follows NP 4542 §4.4 over the parameters held, is derived once, and says what it
   did not cover.
5. A não conforme result raises the water alert on the existing path.
6. The pool's page and the public page show the grade in words.
7. The research file is the cited source, and the decisions are logged.
