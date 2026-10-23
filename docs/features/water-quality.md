# Water quality: the national reference and laboratory results

POOLSE-72, roadmap 7b.3. It lives on the pool's page, on the **Qualidade da água** tab.

## The bands a reading is judged by

Unless a club has set a band of its own, every reading is judged by **NP 4542:2017**, the
standard Portuguese health authorities grade samples with. The values, each cited to its quadro,
are in `@poolse/rules` (`NATIONAL_BANDS`, `nationalBands()`). The source record is
[`docs/research/water-reference-2026-10.md`](../research/water-reference-2026-10.md).

| Metric | Band |
|---|---|
| pH | 6.5–8.0 |
| Free chlorine, covered tank | 0.5–1.2 at pH ≤ 7.4; 1.0–2.0 above |
| Free chlorine, open-air tank | 0.8–1.5 at pH ≤ 7.4; 1.5–3.0 above |
| Combined chlorine | ≤ 0.5 |
| Cyanuric acid | ≤ 100 |
| Total alkalinity | 75–250 |
| Turbidity | ≤ 1.5 NTU |
| Temperature | Depends on the tank's **use** (below) |
| Calcium hardness, salt | Not judged unless the club sets a band |

**Free chlorine follows the pH measured in the same analysis.** With no pH in that analysis, it
is judged against the widest band the standard allows, and the screen says no pH was measured.
NP 4542 leaves pH 7.4–7.5 uncovered for covered tanks, so Poolse puts the split at 7.4. Covered
or open-air is the pool's existing *kind*.

**Temperature comes from what the tank is for.** The pool form has a *Utilização* field:

| Use | Band |
|---|---|
| Sport, water polo, synchronised | 24–26 °C |
| Diving and underwater activities | 26–28 °C |
| Learning, leisure and multi-use | 26–28 °C |
| Maintenance and children's | 28–32 °C |
| Hydrotherapy | 30–36 °C |
| Any use, open-air tank | 24–28 °C |
| No use set | Temperature not judged |

**A club's own band still wins** (*Limites*), and a club can switch a metric off. The band form
labels the reference option with the national band for that tank. A pool with no override of its
own moved to these values on 13-10-2026. The earlier values (pH 7.2–7.6, a flat 0.5–2 for
chlorine, 25–29 °C) cited no source.

## The water tab: own readings and the laboratory (POOLSE-101)

A tank's water tab says it in one line above its pills: *own readings every day; the laboratory's results every month*. The two are different records, made by different people, and each has one place:

- **Registar leitura** is the club's own reading — pH, chlorine, temperature, typed by somebody at the pool. It holds the form and nothing else, and is offered to whoever may record an analysis.
- **Laboratório** is the accredited laboratory's monthly analysis, graded below. It holds the results, *Registar um resultado* and *Importar um relatório do laboratório*.

**Where an imported row is filed is decided by what it holds** (`reportDestination` in `lib/analysis-report.ts`). A row with any organism count is the laboratory's and becomes a lab result — its chemistry with it, never filed a second time as a reading — through `POST …/lab-results/import`, which writes each row with the form's own function, so it is audited, graded and alerted like a typed one. A row with chemistry alone is a reading and goes through the readings import as before; the club's own .xlsx/.csv log can carry no organism, so it always lands there. The preview has a *Vai para* column and a count per destination, and nothing is written before the person ticks and confirms. A lab row with no time is filed at midnight, as a reading is; a sample later than now on the facility's clock is refused on the preview.

**A colony count written as "<1" or as a word of absence (*Ausência*, *não detetado*) is read as 0**: counts are whole numbers, so both mean exactly none. Any other "<N" is a detection limit, not a count, and the row is refused with the parameter named. Importing is owner and admin, as the readings import is.

The parser (`analysis-report-agent.ts`, behind `WATER_REPORT_AI_ENABLED` and `ANTHROPIC_API_KEY`) asks for the seven organisms, the laboratory and the report reference beside the chemistry, and replies through structured output rather than a forced tool call.

## Laboratory results

*Laboratório* records a report from the lab:
- the date and time of sampling;
- the laboratory and the report reference;
- the sampling point and depth (surface, or 10–30 cm below it);
- the seven microbiological parameters;
- any physical and chemical values the lab measured.

A blank box is a parameter the lab did not report. It is never stored as zero.

**The grade follows NP 4542 §4.4, over what the report holds:**
- **Não conforme:** a microbiological limit, or a pH or disinfectant limit, is exceeded.
- **Conforme condicionada:** every limit holds, but a recommended value (colonies, coliforms
  above 0, total staphylococci) or a quality criterion (turbidity, alkalinity) is not met.
- **Conforme:** everything reported passes.

Parameters the lab did not report are named as not covered. A report with chemistry only is
graded on the chemistry and says so. A report with nothing gradeable has no grade, never a
silent *conforme*.

**The grade is derived, never stored.** The pool's page, the alert and the public page all
call `gradeLabResult()` on the stored values. It always uses the national reference for the
tank, never the club's own bands. A club may relax its working pH range, but that does not make
a sample *conforme* under the standard.

Limits that NP 4542 measures against the supply water are not judged. That covers conductivity,
chlorides, oxidability, TOC and nitrates; Poolse stores no supply-water values.

**Alert:** a *não conforme* report sampled in the last 48 hours alerts the owner, the admins
and maintenance, exactly as an out-of-range reading does. The alert is recorded in the same
transaction and emailed after it. The report shows whether the email went out, or why not.

**A correction is a new report.** A report is archived, never edited or deleted.

## Who can do what

| | Owner | Admin | Maintenance | Instructor, guardian, student |
|---|---|---|---|---|
| Read and record lab results | ✓ | ✓ | ✓ | — |
| Import a laboratory report | ✓ | ✓ | — | — |
| Archive a lab result | ✓ | ✓ | — | — |
| Set a pool's use, set bands | ✓ | ✓ | — | — |

## The public water page

It shows the latest lab grade and the day the sample was taken, in words and with an icon.
Nothing else from the report is shown: no laboratory, no reference, no values. A free-chlorine
reading shows the band of the pH split it was judged against.

## Not built

- Reading a lab PDF into the form. The water-log parser still reads chemistry only.
- DR 5/97 as a second regime for hotel pools. A hotel sets its own bands.
- Supply-water values, Legionella, THM and metals.
