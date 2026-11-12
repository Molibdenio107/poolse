# What a utility meter reading should capture: research for the energy module

Researched 12-11-2026. Items marked **[unverified]** could not be confirmed from a primary source.

## 1. Time-of-use periods in Portugal

- **Segments.** BTN covers low voltage up to **41,4 kVA** inclusive. BTE is low voltage above 41,4 kVA. MT, AT and MAT come next (Regulamento 828/2023). A small club or a school pool is usually on BTN. A municipal pool with heat pumps or large circulation pumps is often on BTE, and a large complex may be on MT. The common claim that BTE stops at 45 kVA is **[unverified]**.
- **Tariff options.** BTN can choose *simples*, *bi-horária* (vazio / fora de vazio) or *tri-horária* (vazio / cheias / ponta). BTE, MT, AT and MAT are always **tetra-horária**: ponta, cheias, vazio normal and super vazio. In the two- and three-period options, *vazio* = vazio normal + super vazio, and *fora de vazio* = ponta + cheias (ERSE Diretiva 3/2026, art. 2.º).
- **Cycles.** The *ciclo diário* uses the same hours every day and exists only for BTN and BTE. The *ciclo semanal* splits weekdays, Saturday and Sunday, and its weekdays change with winter and summer legal time. It is available at every voltage level. MT, AT and MAT may also choose the *ciclo semanal por épocas*.
- **Schedules are changing.** ERSE Diretiva 3/2026 (DR 19-08-2026) moves ponta to the evening and removes morning ponta:
  - BTE, MT, AT and MAT change on **1 April 2027**.
  - BTN bi- and tri-horária customers are switched over gradually between **1 July and 31 December 2027**.
  - In the new daily cycle, bi-horária vazio runs **22:30–08:30** (today 22:00–08:00). Tri-horária in the daily cycle becomes cheias 08:30–17:30, ponta 17:30–21:30 and cheias 21:30–22:30. These hours are the same all year, with no summer/winter difference.
  - Super vazio keeps the same start and end in every cycle. I believe that is 02:00–06:00 **[unverified exact hours]**.
  - Today's daily-cycle tri-horária hours in winter, from supplier pages, are ponta 09:00–10:30 and 18:00–20:30, then vazio from 22:00 to 08:00, and cheias for the rest. Summer differs.
- **Design consequence.** Do not hard-code hours. The meter and the bill already assign kWh to registers. Store the registers as read, and treat the hours as reference data with an effective-from date.
- **What the smart meter displays (E-REDES).** It scrolls through codes, each followed by a cumulative kWh value:
  - **1.8.1** vazio, **1.8.2** ponta, **1.8.3** cheias, **1.8.4** super vazio (tetra-horária meters), **1.8.0** total
  - **2.8.x** energy exported (self-consumption PV)
  - **1.6.0 / 1.6.10** maximum power in kW
  - On BTE/MT meters: **5.8.x** inductive reactive energy, **8.8.x** capacitive reactive energy (kvarh), and **13.7** power factor
  - 0.9.1 / 0.9.2 are the meter's time and date.

  To read a register by hand, wait for its code or press the button to step to it, then write down the digits shown next to it. Each register is a running total, so consumption is always the current index minus the previous one, register by register. BTN totals are 1.8.1 + 1.8.2 + 1.8.3.

## 2. Other quantities a pool pays for

| Quantity (pt-PT) | Unit | Cumulative? | How read | Billed how |
|---|---|---|---|---|
| Energia ativa por período (ponta/cheias/vazio normal/super vazio) | kWh | Yes, one index per register | Meter display codes 1.8.x, or *telecontagem* | €/kWh per period |
| Potência contratada | kVA (BTN), kW (BTE/MT) | No (contract value) | On the bill or contract | BTN: fixed €/day by kVA step. BTE/MT: updated to the **highest potência tomada in the last 12 months** |
| Potência tomada | kW | No: maximum 15-min average in the period | Meter code 1.6.0, or the bill | Feeds potência contratada (BTE/MT) |
| Potência em horas de ponta | kW | Derived: ponta kWh ÷ ponta hours | Bill only | €/kW, BTE/MT access tariff |
| Energia reativa indutiva (fora de vazio) | kvarh | Yes | Codes 5.8.x (BTE/MT) | Billed per day when **tg φ > 0,3**, in three tiers (0,3 / 0,4 / 0,5). The tier multipliers (I recall 0,33 / 1 / 3) are **[unverified]** |
| Energia reativa capacitiva (vazio) | kvarh | Yes | Codes 8.8.x | All capacitive kvarh in vazio is billed (AT, MT, BTE). New installations are exempt for 8 months |
| Gás natural | m³ on the meter, kWh on the bill | Yes | Mechanical index in m³ | kWh = m³ × *fator de conversão* (= PCS × Fct × Fcp). The factor is printed on every bill, roughly 11 kWh/m³ |
| Propano / GPL | kg or L delivered; tank % | No (the tank level goes down) | Delivery note, or the gauge % × tank capacity | Per delivery (€/kg or €/L). About 12,8 kWh/kg **[unverified, typical]** |
| Água da rede | m³ | Yes | Utility meter (roller digits; red digits are litres) | €/m³ (non-domestic users are often on a single tier) plus a fixed availability fee. **Saneamento** and sometimes **resíduos** are often charged in proportion to water m³ |
| Água de compensação / submedidor de lavagens | m³ | Yes | Sub-meter on the make-up line or the backwash line | Not billed separately: used to see where the water goes |
| Calor (contador de energia térmica) | kWh or MWh | Yes | Heat meter display (EN 1434) | Not billed unless the heat is bought in. Useful for the heat pump COP = heat kWh ÷ electricity kWh |

Water matters for pools:
- Backwashing uses about **1,5–3 % of the water treated**, roughly 350–600 L per sand-filter wash (manufacturer figure).
- One municipal water-saving measure caps daily renewal at about **3 % of the pool's volume**.
- Make-up water also brings heating cost, because the cold mains water has to be heated.

**Naming trap:** *reposição* is already taken in the schema by the make-up-lesson module. The enum should be `make_up_water`, with *água de compensação* as its label.

## 3. "Highs and lows" analytics, kept practical

ISO 50001 and ISO 50006 practice comes down to four points:
- Keep a **baseline** for each significant energy use.
- Compare against a **normalised** indicator (EnPI), never raw kWh, when a driver exists.
- Watch the **deviation** (actual minus expected).
- Optionally plot a **CUSUM** of the deviation, whose slope shows drift.

For a club typing in monthly or weekly readings, that becomes:

1. **Rate, not total.** Consumption between readings ÷ days between them gives kWh/day and m³/day. Rank highs and lows on this daily rate, because reading intervals vary.
2. **Hard checks when a reading is entered:**
   - The new index is lower than the previous one. That is a typo, a meter replaced or a rollover, so ask which one.
   - The reading is dated before the previous one.
   - The digit count does not fit the meter.
   - The registers do not add up to the total, where a total is entered.
3. **Soft flags:**
   - Daily rate more than about ±30 % from the same period last year, or from the median of the last few intervals. Both thresholds are configurable.
   - A rising **ponta share** of kWh.
   - Peak demand (kW) close to potência contratada (BTE/MT), because next year's contracted power ratchets up to it.
   - Water use that does not stop on closed days: read the meter at closing and again at opening, and treat a night flow as a leak.
4. **Normalising**, simplest first:
   - per day
   - per opening hour or per hour of tank use (the module already divides month by month)
   - for heating gas or heat: per **heating degree-day** (base 15,5–18 °C, from the stored outside temperature)
   - per bather, if attendance is known

   Show the normalised figure beside the raw one and never replace it. This matches the existing rule that outside temperature is context and never corrects a figure.
5. **Compare like with like:** the same months in both years only, as the module already does.

## Recommendations for the reading form

**Minimum**
- Meter (the meter defines the quantity, the unit and the **register set**: single, vazio/fora de vazio, vazio/cheias/ponta, or tetra).
- Reading date.
- One value for each of the meter's registers.
- Value kind: index or consumption. This already exists.
- Source: manual, photo, from a fatura, or utility estimate (*estimativa*).
- A "meter replaced / reset" flag that starts a new chain of readings. Without it, every swap looks like a negative-consumption error.

**Optional, set per meter**
- Maximum demand in kW (code 1.6.0), for BTE/MT meters.
- Inductive and capacitive kvarh, BTE/MT only.
- Exported kWh (2.8.0), where there is PV.
- A photo of the display.
- A free-text note (for example "lavagem de filtros", "esvaziamento").
- For water sub-meters: number of backwashes.

**Not on the reading:** the gas conversion factor, potência contratada and the tariff prices. These belong to the fatura or the contract, and the bill already carries them.

## Sources

- ERSE, Diretiva n.º 3/2026 (períodos horários): https://www.erse.pt/media/3hanbooq/diretiva-nº-3_2026-19-de-agosto-aprova-os-períodos-horários.pdf
- ERSE, 12 perguntas e respostas sobre os novos períodos horários: https://www.erse.pt/media/wsrbhlug/ersexplica_pr_horarios.pdf
- ERSE, períodos horários (map): https://www.erse.pt/media/s0wh5zf0/periodoshorariosele.pdf
- E-REDES, Contador Inteligente (display codes): https://www.e-redes.pt/sites/eredes/files/2023-08/ContadorInteligente.pdf
- E-REDES, Contadores não BTN (register codes 1.8.x, 5.8.x, 8.8.x, 1.6.0): https://www.e-redes.pt/sites/eredes/files/2024-03/Contadores_N%C3%A3o_BTN_E-REDES.pdf
- E-REDES, Faturação de energia reativa: https://www.e-redes.pt/sites/eredes/files/2023-09/Factura%C3%A7%C3%A3o%20de%20energia%20reactiva.pdf
- Voltimum/Schneider, reactive energy tiers 0,3–0,4–0,5 (Despacho ERSE 7253/2010): https://content.voltimum.com/pt/17075/ef_energiareactiva_voltimum_schneider.pdf
- ERSE, Regulamento Tarifário (potência tomada, potência em horas de ponta): https://www.erse.pt/media/5ewbseeb/articulado_rt-se_publicado-dr-com-dretif.pdf
- Regulamento 828/2023 (BTN ≤ 41,4 kVA): https://www.apren.pt/contents/legislation/regulamento-828-2023.pdf
- ERSE, compreender a fatura de gás: https://www.erse.pt/consumidores-de-energia/gas/compreender-a-fatura/
- Repsol, gas conversion factor (PCS × Fct × Fcp): https://www.repsol.pt/particulares/assessoramento/fator-de-conversao-o-que-e-e-como-se-calcula/
- IPP thesis on pool water use (backwash 1,5–3 %): https://recipp.ipp.pt/bitstreams/79119dcb-2bcc-4727-b576-cfba4ef87024/download
- Municipal measure, 3 % daily renewal: https://www.barlavento.pt/wp-content/uploads/2024/03/Medidas.pdf
- MDPI, water efficiency in a municipal indoor pool: https://mdpi.com/2076-3417/11/22/10530
- LBL ISO 50001 Navigator, EnPI and baseline: https://navigator.lbl.gov/guidance/task/11
- US DOE, energy intensity baselining and tracking: https://www.energy.gov/sites/prod/files/2016/02/f29/Energy%20Intensity%20Baselining%20and%20Tracking%20Guidance.pdf
- Invest NI, metering, monitoring and targeting guide (CUSUM, degree-days): https://www.InvestNI.com/sites/default/files/documents/static/library/invest-ni/documents/best-practice-guide-metering-monitoring-and-targeting.pdf
