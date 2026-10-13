# Portuguese national reference values for swimming-pool water: primary-source research

Researched 13-10-2026 for POOLSE-72. Every PDF below was downloaded with curl and its text extracted with `pdftotext`. The copies are not kept in this repo: NP 4542 is IPQ's paid standard, and every document is fetchable from the URLs in §8. Quotes are verbatim from the extracted text. Where layout extraction scrambled a table, the table was re-read in `-raw` mode. Superscripts are lost in extraction, so "102" in the DGS text means 10², and "103" means 10³.

Labels used below:
- **PRIMARY**: the issuing body's own text.
- **PRIMARY-COPY**: the official text, hosted by a third party.
- **SECONDARY**: someone else's summary or citation of the text.

---

## 1. Sources: what they are and whether they are in force

### 1.1 DGS: Circular Normativa n.º 14/DA, 21-08-2009, "Programa de Vigilância Sanitária de Piscinas" (PRIMARY)
- **Issuer:** Direcção-Geral da Saúde, Divisão de Saúde Ambiental. Signed digitally by Francisco George on 2009-08-21.
- **Fetched from:** https://www.dgs.pt/directrizes-da-dgs/normas-e-circulares-normativas/circular-normativa-n-14da-de-21082009-pdf.aspx. This is a 54-page PDF, linked from the landing page https://www.dgs.pt/directrizes-da-dgs/normas-e-circulares-normativas/circular-normativa-n-14da-de-21082009.aspx.
- **Addressed to:** "Administrações Regionais de Saúde, Unidades de Saúde Pública e Autoridades de Saúde". It tells the *health authorities* how to run surveillance. It is not addressed to pool operators.
- **Scope (§3):** Tipo 1 (públicas) and Tipo 2 (semi-públicas: hotels, schools, health clubs, condominiums, therapeutic pools), whether freshwater or saltwater, covered or open-air. Tipo 3 (private family pools) is excluded. For Tipo 2, the health services do not have to collect samples. They evaluate the operator's own analyses instead.
- **Its own statement on the legal vacuum (§3):** "Alguns dos tipos de piscinas abrangidos por este programa de vigilância sanitária têm legislação própria, nomeadamente as piscinas inseridas em recintos com diversões aquáticas e as de hidroterapia. Para todas as outras não existem diplomas legais que estabeleçam requisitos de qualidade da água."
- **Status: still the current DGS document, and nothing has replaced it.** Evidence:
  1. The DGS page for pools still lists it as the norm: https://www.dgs.pt/saude-ambiental/areas-de-intervencao/agua/piscinas.aspx, fetched. That page lists only CN 14/DA and Circular Informativa 31/DA (occupational health and safety) as DGS documents, plus DL 65/97, DR 5/97, Portaria 358/2009, DL 141/2009 and Aviso 9448/2002.
  2. Madeira's *Relatório PVSP 2025*, dated 30-01-2026, says: "Os critérios e procedimentos de atuação no âmbito do Programa de Vigilância Sanitária das Piscinas foram baseados na Circular Normativa n.º 14/DA, de 21 de agosto de 2009 da Direção-Geral da Saúde (DGS)." Source: https://www.madeira.gov.pt//Portals/53/Documentos/DLSA/Relat%C3%B3rio%20PVSP%20-%202025.pdf, fetched.
  3. Search snippets say Despacho n.º 2064/2021 (24-02-2021) lists "a revisão da Norma referente ao Programa de Vigilância Sanitária em Piscinas de Utilização Pública" as a goal. That would make a revision planned but not yet published. **SECONDARY / UNVERIFIED:** diariodarepublica.pt renders that page with JavaScript, and WebFetch returned it empty twice.
  4. A 2026 municipal regulation (Avis) cites a "Circular Normativa n.º 24/2018 da DGS - Programa de Vigilância Sanitária de Piscinas". Source: https://cm-avis.pt/wp-content/uploads/2026/06/Normas_Piscinas-Municipais_2026_FINAL.pdf, fetched, line 120. **No such document appears on the DGS pool page or in any search.** It is most likely a municipal mistake for 14/DA. Treat it as UNVERIFIED and not as a replacement.
- **Legal nature:** an administrative circular from the DGS to the public-health services. It is not a law, and it does not directly bind pool operators.

### 1.2 Decreto Regulamentar n.º 5/97, 31-03-1997 (PRIMARY: the original Diário da República)
- **Full title:** "Regulamento das Condições Técnicas e de Segurança dos Recintos com Diversões Aquáticas". Ministério do Equipamento, do Planeamento e da Administração do Território. DR I Série-B, n.º 75, pp. 1397–1422.
- **Fetched from:** https://files.diariodarepublica.pt/1s/1997/03/075b00/13971422.pdf (26 pp.). files.dre.pt serves the same file, and the DGS pool page links it as http://dre.pt/pdf1sdip/1997/03/075B00/13971422.pdf.
- **Direct scope:** water parks ("recintos com diversões aquáticas"), under DL 65/97 of the same date. DL 65/97 was amended by DL 79/2009 and republished by DL 86/2012 (SECONDARY, from search results).
- **Scope by reference.** Two other instruments point to its Anexo II, so in practice it is the legally binding water standard for two other pool categories:
  - **Tourist-establishment pools (hotels and the like): PRIMARY, verified.** Portaria n.º 358/2009, de 6 de abril, art. 5.º n.º 3, fetched from https://files.diariodarepublica.pt/1s/2009/04/06700/0213202133.pdf: "As piscinas dos empreendimentos turísticos devem ter equipamentos que garantam que a qualidade da água obedece aos parâmetros definidos pelo Decreto Regulamentar n.º 5/97, de 31 de Março, ou por outros diplomas que venham a regular a matéria da qualidade da água."
  - **Hydrotherapy and therapeutic pools: SECONDARY.** Aviso n.º 9448/2002 (Manual de Boas Práticas de Medicina Física e Reabilitação) says the water must be "própria, de acordo o estabelecido no anexo II do Decreto-Lei n.º 65/97". I have this only as quoted by ARSLVT 2014 (§1.5). I did not fetch the Aviso.
- **Status:** I found no revocation. It is cited as in force by ARSLVT (2014), by AHRESP's guide (2024) and by NP 4542:2017 itself. Madeira adapted the regime in DLR 2/2010/M (SECONDARY). **I could not view a consolidated version on diariodarepublica.pt (JS-rendered), so "not revoked" rests on absence of evidence plus continued citation.**

### 1.3 NP 4542:2017, "Piscinas. Requisitos de qualidade e tratamento da água para uso nos tanques" (PRIMARY-COPY)
- **Issuer:** Instituto Português da Qualidade (IPQ). Prepared by technical committee CT 166 (CATIM). Termo de Homologação n.º 32/2017, de 2017-02-10, 2.ª edição, 2017-02-15. It revises NP 4542:2016.
- **Fetched from:** a copy hosted by the Câmara Municipal de Moura, https://www.cm-moura.pt/wp-content/uploads/2024/08/516088929-Norma-Portuguesa-45422017.pdf (25 pp.). The copy is marked "IPQ reprodução proibida". This is the actual standard text, but **not** obtained from IPQ, which sells it.
- **Scope (§1 / §3.5 note):** "aplica-se a todas as piscinas de uso público, piscinas tipo 1 e tipo 2". It "não se aplica às piscinas do tipo 3 nem a jacúzis e tanques de hidromassagem".
  - Tipo 1 means aquatic activity is the main business: municipal pools, leisure pools, water parks.
  - Tipo 2 means a complementary service: hotels, campsites, clubs, therapeutic pools.
  - IPQ's 2022 guide adds that it does not apply to "piscinas de uso familiar, nem às de condomínios ou de unidades de vizinhança, até um máximo de vinte unidades de habitação permanente". Source: https://storagewebsiteipq.blob.core.windows.net/website/CS04_Guia_Qual_Piscinas_Uso_Privado_Jan2022.pdf, fetched.
- **Legal nature:** a Portuguese Standard, voluntary unless a law makes it binding. I found no law that does.
- **In practice it is the current technical reference.** The regional health authority uses it to grade samples. Madeira's PVSP 2025 says: "Como norma orientadora de âmbito técnico, destaca-se a Norma Portuguesa NP 4542 2017 ... relativa aos requisitos de qualidade e tratamento da água para uso nos tanques". Its Tables 1 and 2 and its classification are taken from NP 4542:2017.
- **No newer edition found.** A search for NP 4542:2023, 2024 or 2025 returned nothing. UNVERIFIED against IPQ's catalogue.

### 1.4 Diretiva CNQ n.º 23/93, "A qualidade nas piscinas de uso público" (Conselho Nacional da Qualidade): NOT FETCHED, SECONDARY only
- **Attempts:**
  - https://www.cm-penafiel.pt/wp-content/uploads/2016/09/DIRECTIVA_CNQ23-93-PiscinasPublicas.pdf returned HTTP 404 with an empty body, on two attempts with different user agents.
  - https://mariorebola.com/wp-content/uploads/DIRECTIVA_CNQ23_93.pdf returned 404.
  - I found no IPQ-hosted copy.
- **Status: revoked, but its water-treatment recommendations are still treated as valid.**
  - IPQ guide 2022 (PRIMARY for this statement, from the issuing body's successor): "Com a transcrição e publicação da norma NP EN 15288, partes 1 e 2, sobre segurança nas piscinas, a Diretiva CNQ 23/93 foi revogada, mantendo-se, no entanto, válidas as recomendações respeitantes ao tratamento de água, visto ser uma matéria não abrangida pela referida norma."
  - The IPDJ Caderno Técnico (2012) says the same thing. Source: https://ipdj.gov.pt/documents/20123/125428/1.+Caderno+T%C3%A9cnico_Inst_Trat_Agua_V3bb.pdf/..., fetched.
  - ARSLVT 2014 calls it a document "de âmbito técnico, mas sem carácter legal".
- **Its values, as quoted by IPDJ 2012 p. 20–21 (SECONDARY):**
  - "Teor de cloro livre – mínimo de 0,5 e máximo de 1,2 mg/l, p/ pH entre 6,9 e 7,4; – mínimo de 1,0 e máximo de 2,0 mg/l, p/ pH entre 7,5 e 8,0"
  - "Teor de cloro total – igual no máximo ao teor de cloro livre + 0,5 mg/litro"
  - "Teor de ácido isocianúrico – inferior ou igual a 75 mg/litro"
  - "Teor de bromo – mínimo de 1 mg/l e máximo de 2 mg/l p/ pH entre 7,5 e 8,0"
  - Ozone systems: residual "inferior a 0.01 mg/l" at return. Complementary chlorine "mínimo de 0,01 e máximo de 0,03 mg/l, com o teor de cloro total máximo de 0,5 mg/l, para valores de pH entre 7,2 e 7,8".
- **Further values quoted by ARSLVT 2014, Quadro II, footnote (1) = CNQ 23/93 (SECONDARY):**
  - Free chlorine 0,5–2,0 VmR–VMR.
  - Combined chlorine VMR 0,5.
  - Temperature 28 °C for covered pools and 30 °C for chapinheiros.
  - pH 6,9–8,0, with footnote (19): "pH= 6,9 - 7,4 (para um teor de cloro entre 0,5 e 1,2 mg/l) e pH= 7,5 - 8,0 (para um teor de cloro entre 1,0 e 2,0 mg/l)".
  - Ozone <0,01.
  - Air: hall humidity 55–75 %, air temperature ≥ the coldest tank's water temperature + 2 °C with a minimum of 24 °C, 6 L/s of fresh air per bather. DGS CN 14/DA Tabela 7 cites CNQ 23/93 for the same air values.

### 1.5 ARSLVT, "Orientações do Programa de Vigilância Sanitária das Piscinas", March 2014 (regional authority; SECONDARY for national values)
- **Fetched from:** https://www.dgs.pt/delegado-de-saude-regional-de-lisboa-e-vale-do-tejo/paginas-acessorias/ficheiros-externos/saude-ambiental/piscinas/orientacoes-pvs-piscinas-2014-pdf.aspx (73 pp.). Issued by the Departamento de Saúde Pública of the Lisbon and Tagus Valley regional health administration.
- **Why it matters:** it is the most explicit official side-by-side of CNQ 23/93, DR 5/97 and WHO 2006. It also shows the three-tier classification as health authorities applied it before NP 4542:2017. It is regional and predates NP 4542:2017.

### 1.6 Other instruments checked
- **Correction, same day:** the finding below is wrong. Portaria n.º 454/2023, de 28 de dezembro, exists, and art. 46.º is the operating-regulation rule. See `public-notices-2026-10.md` §2.1. The original note follows.
- **"Portaria 454/2023": nothing found.** A search returned only Brazilian results. No Portuguese portaria with this number concerning pools turned up, and the DGS pool page does not list one. **UNVERIFIED that it exists or touches pools. Do not cite it.**
- **No 2024 or 2025 Portuguese decree-law on pool water quality was found.** DL 69/2023 (water for human consumption) does not cover pool water. The DGS pool page lists no newer law.
- **DL 141/2009 (sports facilities for public use):** listed on the DGS page and in ARSLVT 2014. I did not check whether it sets water parameters. ARSLVT says the licensing it provides for "não esteja regulamentada".

---

## 2. Physical and chemical values: side by side

Columns:
- **DGS CN 14/DA:** Tabela 5 (freshwater), p. 13. "Valores indicativos". Surveillance sampling is quarterly.
- **DR 5/97:** Anexo II, Quadros I and II, pp. 1418–1419. VR is the valor recomendado and VL the valor limite.
- **NP 4542:2017:** Quadro 1 is the quality criterion and Quadro 2 holds the VL, pp. 8–9.

| Parameter | DGS CN 14/DA (2009) | DR 5/97 (law; water parks + tourist pools) | NP 4542:2017 (IPQ standard; current technical reference) |
|---|---|---|---|
| **pH** | 6,9 – 8,0 (Sørensen, 25 °C) | VR 7,4 a 7,6; VL 7 a 8 | VL 6,5 a 8,0. "Se o desinfetante for à base de cloro, o pH deve manter-se, de preferência, entre 7,0 e 7,4" |
| **Free residual chlorine (mg/L Cl₂), pH-dependent** | "0,5 – 1,2 (6,9> pH ≤7,4)"; "1,0 – 2,0 (7,5> pH ≤8,0)". The ">" is a typo in the original; read as 6,9–7,4 and 7,5–8,0 | Pools: "0,5 — 1,2mg/l com pH de 7 a 7,4; 1 — 2mg/l com pH de 7,4 a 8". "Outros tanques de actividades (2): 1mg/l a 3mg/l", meaning tanks used with buoys or boats. To be measured on site | **Covered tanks:** "0,5 mg/L a 1,2 mg/L, com pH de 6,5 a 7,4; 1,0 mg/L a 2,0 mg/L, com pH de 7,5 a 8,0". **Open-air tanks:** "0,8 mg/L a 1,5 mg/L, com pH de 6,5 a 7,4; 1,5 mg/L a 3,0 mg/L, com pH de 7,4 a 8,0" |
| **Combined chlorine** | ≤ 0,5 mg/L Cl₂ (calculated) | No separate line. Implied ≤ 0,6 from the total-chlorine rule | No separate line. Implied ≤ 0,5 from the total-chlorine rule |
| **Total chlorine** | "Igual ao máximo de cloro livre + 0,5mg/l (1,0 – 2,5)" | "Cloro residual livre + 0,6mg/l" | "Máximo: cloro residual livre + 0,5 mg/L" |
| **Bromine (total, mg/L Br₂)** | 2,0 – 4,0 | VR 1; VL "0,8 a 2mg/l" (Quadro II) | 2,0 mg/L a 4,0 mg/L |
| **Cyanuric acid (isocyanuric)** | ≤ 75 mg/L | VL 75 mg/l | ≤ 100 mg/L. Only when stabilised chlorine is used. Measure **weekly** (§4.3.1) |
| **Temperature** | Covered pools: ≤ 30 °C | "‹ 24º a 30º (para piscinas aquecidas)". Column placement is ambiguous in the print; ARSLVT reads it as a VR of 24–30 | Anexo D, Quadro D.1, by type: sport swimming, water polo and synchronised 24–26 °C; diving and underwater 26–28 °C; learning, recreation and multi-use 26–28 °C; maintenance and children's pools 28–32 °C; heated open-air pools 24–28 °C; hydrotherapy 30–36 °C |
| **Turbidity** | "0,5 – 4" UNT. Printed as a range, probably a recommended value of 0,5 and a limit of 4; INSA reads it as "≤4" | "‹ 6 UNF ou disco de Secchi". Footnote: transparency "controlada em contínuo, através de uma marca ... no máximo 0,15 m, colocada no ponto mais fundo do tanque" | ≤ 1,5 UNT (or ≤ 2 mg/L SiO₂). ≤ 0,5 UNT when UV is used |
| **Transparency** | Qualitative check at sampling | Mark of at most 0,15 m on the deepest point, continuously visible | "sempre visível com perfeita nitidez as marcas existentes no fundo do tanque" (§4.2) |
| **Conductivity** | 1500 µS/cm at 20 °C. Not applicable to seawater or salt electrolysis (Tabela 6: compare with the supply water) | VR ‹ 900; VL 1700 µS/cm | "Não exceder em 1000 μS/cm a condutividade da água de abastecimento" |
| **Chlorides** | 500 mg/L Cl⁻ | — | "No máximo 10 vezes a concentração da água de alimentação". Not applicable to saltwater or salt electrolysis |
| **Oxidability (KMnO₄)** | 6 mg/L O₂ (acid medium). Footnote 7: consider the supply water's value | "Não ultrapassar em 4mg/l de O2 o valor determinado na água que abastece o tanque (medida pelo KMnO4 a quente e em meio alcalino)" | "Não exceder em 4 mg/L de O2 a oxidabilidade da água de abastecimento" (NP 731). Measure this **or** TOC |
| **TOC** | 6 mg C | — | "Não exceder em 4 mg/L o COT da água de abastecimento". Correct for cyanuric acid with X = 0,28·C |
| **Ammonia / ammonium** | — | "Amoníaco (3)": VR 0,5 mg/l, VL ‹ 1,5 mg/l, "Quando pedido pela autoridade de saúde" | Azoto amoniacal ≤ 0,5 mg/L NH₄, "Determinar apenas em piscinas terapêuticas" |
| **Nitrates** | — | — | "Não exceder em 10 mg/L NO3 a concentração da água de abastecimento" |
| **Total alkalinity** | — | — | "Entre 75 mg/L e 250 mg/L CaCO3" |
| **Colour** | — | — | < 20 mg/L Pt/Co |
| **Copper** | 2 mg/L Cu | VL 2 mg/l | ≤ 3 mg/L Cu, only if a copper product is used |
| **Aluminium / iron** | — | — | ≤ 0,3 mg/L Al and ≤ 0,2 mg/L Fe, if Al or Fe salts are used |
| **Ozone** | — | VR 0; VL ‹ 0,01 mg/l | "Após a redução do ozono: ≤ 0,01 mg/L O3" |
| **Silver** | — | "Prata ... 0,1 10mg/l" (VR 0,1, VL 10 as printed; 10 mg/L looks implausibly high, but it is what the DR says) | — |
| **Trihalomethanes** | Covered pools: total 100 µg/L | — | 100 µg/L; quarterly analysis recommended |
| **Foam, grease, foreign matter** | — | — | "Ausência à vista desarmada" |

### Free chlorine against pH: the exact pairs and how they disagree
- **DGS CN 14/DA:** 0,5–1,2 for pH 6,9–7,4, and 1,0–2,0 for pH 7,5–8,0. The original typography reads "(6,9> pH ≤7,4)" and "(7,5> pH ≤8,0)". The intent is clear but the inequality is literally wrong, and pH 7,4–7,5 belongs to neither band.
- **CNQ 23/93 (SECONDARY):** the same pairs, 6,9–7,4 and 7,5–8,0.
- **DR 5/97:** 0,5–1,2 for pH 7 to 7,4, and 1–2 for pH 7,4 to 8. pH 7,4 itself falls in both bands.
- **NP 4542:2017, covered tanks:** 0,5–1,2 for pH 6,5–7,4, and 1,0–2,0 for pH 7,5–8,0. This leaves a gap between 7,4 and 7,5.
- **NP 4542:2017, open-air tanks:** 0,8–1,5 for pH 6,5–7,4, and 1,5–3,0 for pH **7,4**–8,0. The open-air bands touch at 7,4, unlike the covered ones.
- **How Madeira transcribes NP 4542:** "0,5-1,2 (6,5<pH≤7,4)" and "1,0-2,0 (7,5<pH≤8,0)", i.e. strict lower bounds.
- **Implementation note:** no source defines what happens between 7,4 and 7,5. A sensible implementation treats the low band as pH ≤ 7,4 and the high band as pH > 7,4. That is a product decision, not something any source says.
- **A single 0,5–2,0 range also appears in official use:** ARSLVT 2014 (VmR–VMR, citing CNQ 23/93), Madeira 2025 ("valores recomendados pela NP 4542/2017 ... entre 0,5 e 2 mg/l de Cl2"), INSA 2014 ("VI 0,5 - 2"), and NP 4542 Anexo C (reopening after a faecal accident: "cloro entre os 0,5 mg/L e 2,0 mg/L e pH entre 6,9 e 8,0").

---

## 3. Microbiological values

| Parameter (unit) | DGS CN 14/DA Tabela 3 (p. 11) | DR 5/97 Anexo II Quadro III (p. 1419) | NP 4542:2017 Quadro 3 (p. 10) |
|---|---|---|---|
| Colonies at 37 °C, 24 h (CFU/mL) | VR ≤ 100 *; VL — | VR "‹ 100ml às vinte e quatro horas (1)", i.e. per mL; VL — | VR ≤ 100; VL — |
| Coliform bacteria / total coliforms (CFU/100 mL) | VR 0; VL 10 | VR 0/100ml; VL 10/100ml | VR 0; VL 10 |
| *E. coli* (CFU/100 mL) | VL 0 | VL 0/100ml | VL 0 |
| Enterococci / faecal enterococci (CFU/100 mL) | VL 0 | VL 0/100ml ("Enterococos fecais") | VL 0 |
| *Pseudomonas aeruginosa* (CFU/100 mL) | VL 0 | VL 0/100ml | VL 0 |
| Coagulase-positive *Staphylococcus* (CFU/100 mL) | VL 0 ** | VR 0/100ml; VL "0/100ml em 90% das amostras" | VL 0 |
| Total *Staphylococcus* (CFU/100 mL) | VR ≤ 20 *; VL — | VR ‹ 20/100ml (1) | VR ≤ 20; VL — |
| *Legionella* | Hydromassage tanks only, quarterly, N.º/1000 mL. Tabela 4: <10² is "Sob controlo"; 10²–10³ means clean and disinfect, closure not compulsory; >10³ means immediate closure and shock dosing at 50 mg/L for 1 h. Avaliação pontual: "No caso da Legionella spp, este VL é <102" | not listed | *Legionella* spp. other than *pneumophila*: VL 100 CFU/1000 mL. *L. pneumophila*: VL 0 CFU/1000 mL. "A realizar apenas em piscinas com dispositivos que promovam a formação de aerossóis" |

Footnotes in DGS CN 14/DA Tabela 3, verbatim:
- "* O Valor Recomendado poderá ser ultrapassado uma vez por época de abertura ao público ou por ano civil."
- "** 0/100 ml em 90% das amostras, sendo da responsabilidade dos serviços de saúde locais efectuar a avaliação no final da época ou ano civil."
- Synonyms the circular gives: colonies at 37 °C are "germes totais, germes aeróbios, microrganismos viáveis"; coliform bacteria are "coliformes totais"; enterococci are "estreptococos fecais e de enterococos fecais".

DR 5/97 footnote (1): "Poder-se-á ultrapassar o valor recomendado uma vez por época de abertura ao público."

NP 4542 §4.3.2 adds that the health authority may order other tests when it suspects a problem: *Candida albicans*, *Salmonella*, *Legionella*, protozoa and helminths.

**The microbiological limits agree across all three sources.** The only real differences are Legionella and the "90 % of samples" softening for coagulase-positive staphylococci, which CN 14/DA and DR 5/97 have and NP 4542 does not.

---

## 4. Classification of a laboratory result

### 4.1 NP 4542:2017 §4.4, "Interpretação dos resultados" (p. 12): the scheme Madeira uses today
> "Água conforme — São cumpridos os critérios de qualidade e os valores limite referidos nos Quadros 1, 2 e 3;
> Água conforme condicionada — São cumpridos os valores limite referidos no Quadro 3 mas, não é cumprido pelo menos um valor recomendado do mesmo Quadro. ou não é cumprido pelo menos um valor limite dos referidos no Quadro 1
> Água não conforme 1) — Não é cumprido pelo menos um valor limite dos Quadros 2 e 3.
> 1) No caso de uma análise de água não conforme, a autoridade de saúde (mediante a avaliação do risco para a saúde) poderá proceder à suspensão imediata da atividade ou atividades aquáticas servidas pela água imprópria, até que os responsáveis pela piscina procedam a uma nova análise em laboratório acreditado e que a mesma satisfaça os requisitos definidos nos Quadros 1, 2 e 3."

The rule in plain terms:
- **Não conforme:** any microbiological VL (Quadro 3) fails, **or** any disinfection-related VL (Quadro 2) fails. Quadro 2 covers pH, free and total chlorine, bromine, ozone, cyanuric acid and THM.
- **Conforme condicionada:** all Quadro 3 VLs pass, but a Quadro 3 VR fails (colonies at 37 °C, coliforms > 0, total staphylococci) **or** a Quadro 1 criterion fails (turbidity, conductivity, chlorides, oxidability, alkalinity, nitrates and so on).
- **Conforme:** everything passes.

How Madeira 2025 applies it (§3.4) is narrower. It grades on microbiology only: "Água Conforme – quando são cumpridos os VL referidos na Tabela 1; Água Conforme Condicionada – quando são cumpridos os VL na Tabela 1, mas não é cumprido pelo menos um VR da mesma tabela; Água Não Conforme – quando não é cumprido pelo menos um VL da Tabela 1." Its Tabela 1 is the microbiological table. Madeira reports chlorine compliance separately, as a share of samples in 0,5–2 mg/L.

### 4.2 DGS CN 14/DA §5.2.1 d), "Avaliação pontual" (p. 15): two classes, microbiology only
> "Própria para o fim a que se destina, quanto aos parâmetros analisados – nenhum dos parâmetros microbiológicos ultrapassa os VL referidos na Tabela 3. No caso da Legionella spp, este VL é <102.
> Imprópria para o fim a que se destina – se algum dos parâmetros analisados apresentar os seguintes resultados:"

| Parâmetro | Valor indicativo |
|---|---|
| Microrganismos cultiváveis | > 100 UFC/ml |
| Bactérias coliformes | > 10 UFC/100 ml |
| Escherichia coli | > 0 UFC/100 ml |
| Enterococos | > 0 UFC/100 ml |
| Pseudomonas aeruginosa | > 0 UFC/100 ml |
| Estafilococos produtores de coagulase | > 0 UFC/100 ml |
| N.º total de Estafilococos | > 20 UFC/100 ml |
| Legionella spp | > 10³ /1000 ml |
| Legionella pneumophila | > 0 / 1000 ml |

**This table contradicts the rule above it.** It makes colonies > 100/mL and total staphylococci > 20/100 mL "imprópria", although Tabela 3 classes those as recommended values only, with no VL. A model built on this source has to pick one reading.

When a result is imprópria, the circular says: close the tank; shock-dose to 20 mg/L Cl₂ for 8 h (or 40 mg/L for 4 h); resample; keep the tank closed if the second result confirms. Section 6 also lists alert situations that justify closure: "Acidente fecal", "Acidente hemorrágico", "Acidente com vómito", broken glass, "Qualidade da água imprópria", and epidemiological evidence.

### 4.3 DR 5/97, art. 31.º (p. 1405): three classes, própria / aceitável / imprópria
> "2 — A água das actividades aquáticas deverá ser própria ou aceitável, de acordo com o anexo II.
> 3 — A classificação é aceitável quando algumas das características ultrapassarem, pontualmente, os limites recomendados no anexo II, até um máximo de três vezes não consecutivas na época, excepto no que se refere a produtos tóxicos, radioactivos, indicadores de contaminação fecal, ou microrganismos patogénicos, casos em que se considera imprópria.
> 4 — A existência de água imprópria obriga à realização de nova análise em laboratório oficial ou creditado junto da entidade fiscalizadora.
> 5 — Caso a nova análise confirme a má qualidade da água, a entidade fiscalizadora procederá de imediato ao encerramento da actividade ou actividades aquáticas servidas pela água imprópria, até que a mesma se encontre em condições potáveis."

### 4.4 ARSLVT 2014 §6 (regional, SECONDARY): spot result, sanitary assessment and annual grade
- **Spot result, for microbiology (Quadro I) and physico-chemistry (Quadro II) separately:**
  - "Água conforme – São cumpridos os valores admissíveis e os valores recomendados".
  - Second tier: "São cumpridos os valores admissíveis mas não é cumprido pelo menos um valor recomendado". The original prints "Água conforme" again here, evidently meaning "conforme condicionada".
  - "Água não conforme – Não é cumprido pelo menos um valor admissível".
- **Sanitary assessment by the sanitary engineers:** "Qualidade Própria / Qualidade Sob Vigilância Reforçada / Qualidade Imprópria".
- **Annual grade, Quadro III:** Boa / Aceitável / Má, by percentage of samples classed própria. For example, *E. coli* >90 % is Boa, 85–90 % Aceitável, <85 % Má. Disinfectant and pH: >70 %, 50–70 %, <50 %. At least 5 samples are needed for a covered pool and 2 for an open-air pool.

---

## 5. Sampling points

**DGS CN 14/DA, Tabela 2, p. 10:**
- Bacteriological sample: "o local de colheita deve ser junto ao rebordo interno, no ponto mais afastado da entrada de água na piscina". Taken at the surface, and also at depth "a cerca de 1 metro de profundidade" or "cerca de meia altura da piscina" with a dip bottle.
- Chemical sample: "o local de colheita deve ser junto a uma das saídas de água", at about 20 cm.
- At most 6 h between sampling and the start of analysis.
- Preferably sampled "durante os períodos de máxima afluência dos banhistas, tendo os pontos de colheita que ser devidamente identificados".
- Measured on site at sampling: water temperature, pH, and total and free disinfectant.

**NP 4542:2017 §4.3.3:**
- Two sample types, "superficiais e subsuperficiais". The subsurface sample is taken 10 to 30 cm below the surface.
- "O local da colheita deve situar-se junto ao rebordo interno, no ponto mais afastado da entrada da água na piscina".
- Samples are taken "durante o período de utilização do tanque".
- Bottles contain sodium thiosulphate.
- At most 8 h to analysis, carried at 5 ± 3 °C.
- The laboratory must be accredited under NP EN ISO 17025.

**DR 5/97 art. 35.º n.º 2:** "As amostras de água para as análises diárias devem ser colhidas pelo menos em dois pontos da massa de água presente em cada tanque."

The ARSLVT 2014 lab-request form records a "Código do ponto de colheita" and whether the sample was taken at the surface or at depth.

---

## 6. Frequencies

### Operator (in-house) measurements

**DR 5/97, art. 35.º n.º 1 (binding for water parks and tourist pools):**
> "As determinações do cloro livre, do pH e da turvação serão realizadas de quatro em quatro horas, sendo a primeira obrigatoriamente feita antes da abertura diária das instalações ao público"

**NP 4542:2017 §4.3.1:**
> "as determinações de cloro residual livre e cloro total (quando se use um desinfetante à base de cloro), ou de bromo total (quando se use um desinfectante à base de bromo), do pH, o registo da avaliação qualitativa da transparência, e da temperatura da água devem ser realizadas, para cada tanque, no mínimo, três vezes por dia. A primeira medição deve ser efetuada antes da abertura diária das instalações ao público"

Cyanuric acid is measured weekly when stabilised chlorine is used.

**NP 4542:2017 §7, "Registo sanitário". This conflicts with §4.3.1 of the same standard:**
> "As medições do cloro livre, do pH e da turvação que devem ser realizadas de quatro em quatro horas, sendo a primeira obrigatoriamente feita antes da abertura diária ..."
> "As observações relativas à temperatura da água nos tanques aquecidos, pelo menos duas vezes"

The daily record also holds the number of bathers, the fresh-water meter reading, filter washes and incidents. pH, disinfectant and temperature must be posted near the entrance.

**DGS CN 14/DA, Anexo III d), "Ficha de Registo Diário":** a template with two time slots per day. Each slot records pH, water temperature, residual disinfectant, total disinfectant and transparency. The sheet also records the number of bathers, the refill volume and filter washing. The template implies two readings a day but states no minimum in the text.

**ARSLVT 2014, template letter to operators:** "Mantido o controlo, e respectivo registo, do teor de cloro residual livre e combinado (ou bromo total), pH e temperatura da água, no mínimo uma vez por dia".

### Laboratory analyses

- **DR 5/97 art. 35.º n.º 3:** "As análises físico-químicas e bacteriológicas serão feitas duas vezes por mês, com um mínimo de 10 dias de intervalo, por recurso a laboratórios oficiais ou acreditados".
- **NP 4542:2017 §4.3:** "As análises físico-químicas devem ser realizadas mensalmente e as microbiológicas devem ser realizadas, no mínimo, quinzenalmente, e sempre que se verifique a ocorrência de um acidente fecal ou com vómito, por recurso a laboratórios acreditados". THM analysis is recommended quarterly.
- **DGS CN 14/DA, the health services' own surveillance sampling:** microbiological monthly ("Mensal", Tabela 3); Legionella quarterly in hydromassage tanks; physico-chemical quarterly ("Trimestral", Tabela 5). Inspection visits at least once a year. The questionnaires are repeated every 4 years.
- **ARSLVT 2014 §5.1:** surveillance sampling monthly. If that is not possible, every two months for collective-use pools, monthly for therapeutic pools, and field determinations only for tourist pools.

### Water renewal (related)
- **DR 5/97 art. 32.º:** at least 2 % of the tank volume per day, which the authorities can raise to 5 %. Full recirculation every ≤ 6 h.
- **NP 4542 §5.4:** 30 L per bather per day, at least 2 % of the volume, which the authorities can raise to 5 %.

---

## 7. What remains unverified or uncertain

1. **CNQ 23/93's own text was not read.** Both known copies returned 404. All its values here are SECONDARY, via IPDJ 2012 and ARSLVT 2014. It is in any case revoked, apart from its water-treatment recommendations.
2. **NP 4542:2017 was read from a municipal copy (CM Moura), not from IPQ.** The text is internally consistent and matches Madeira's transcription and IPQ's 2022 guide. Not checked: whether IPQ has issued an amendment or a newer edition since 2017.
3. **Whether DR 5/97 has been revoked was not confirmed** against a consolidated version on diariodarepublica.pt (JS-rendered). It is still cited as in force as late as 2024–2026.
4. **Despacho n.º 2064/2021** (the planned revision of the DGS pool norm) is known only from search snippets; the page would not render. No revised DGS norm was found.
5. **"Circular Normativa n.º 24/2018 da DGS"** is cited by a municipality but appears nowhere at DGS. Probably an error.
6. **"Portaria 454/2023"** was not found in this search. **Corrected the same day**: it exists, and art. 46.º is the operating-regulation rule (`public-notices-2026-10.md` §2.1).
7. **Garbled print in DR 5/97.** The "‹" characters are mis-encoded in the 1997 PDF and are probably "<". The temperature line ("‹ 24º a 30º") has ambiguous column placement. Read in context, the colonies line "‹ 100ml" means < 100 per mL.
8. **Scrambled table in DGS CN 14/DA.** Tabela 5 came out jumbled in layout mode. The values above come from the `-raw` re-extraction, which pairs each parameter with its value cleanly. Turbidity "0,5 – 4" is printed as a range; INSA reads it as ≤ 4.
9. **Madeira 2025, Tabela 2: one value uncertain.** Its turbidity cell extracted ambiguously, as "0,5-2,0" sitting where NP 4542 says ≤ 1,5. Its temperature is "≤32" for covered pools, which is not an NP 4542 figure. I have not relied on Madeira for either.
10. **Therapeutic pools:** that Aviso 9448/2002 refers them to DR 5/97 Anexo II comes only via ARSLVT's quotation.

---

## 8. URLs actually fetched
- https://www.dgs.pt/directrizes-da-dgs/normas-e-circulares-normativas/circular-normativa-n-14da-de-21082009-pdf.aspx (CN 14/DA, 54 pp.)
- https://www.dgs.pt/directrizes-da-dgs/normas-e-circulares-normativas/circular-normativa-n-14da-de-21082009.aspx
- https://www.dgs.pt/saude-ambiental/areas-de-intervencao/agua/piscinas.aspx
- https://files.diariodarepublica.pt/1s/1997/03/075b00/13971422.pdf (DR 5/97)
- https://files.diariodarepublica.pt/1s/2009/04/06700/0213202133.pdf (Portaria 358/2009)
- https://files.diariodarepublica.pt/1s/1997/03/075a00/13861391.pdf (DL 65/97; downloaded, not analysed)
- https://www.cm-moura.pt/wp-content/uploads/2024/08/516088929-Norma-Portuguesa-45422017.pdf (NP 4542:2017)
- https://www.madeira.gov.pt//Portals/53/Documentos/DLSA/Relat%C3%B3rio%20PVSP%20-%202025.pdf
- https://www.dgs.pt/delegado-de-saude-regional-de-lisboa-e-vale-do-tejo/paginas-acessorias/ficheiros-externos/saude-ambiental/piscinas/orientacoes-pvs-piscinas-2014-pdf.aspx (ARSLVT 2014)
- https://repositorio.insa.pt/bitstreams/ce9ad902-0406-44f1-a477-2e280bf2c786/download (INSA Boletim Epidemiológico 2014, especial 4)
- https://storagewebsiteipq.blob.core.windows.net/website/CS04_Guia_Qual_Piscinas_Uso_Privado_Jan2022.pdf (IPQ guide 2022)
- https://ipdj.gov.pt/documents/20123/125428/1.+Caderno+T%C3%A9cnico_Inst_Trat_Agua_V3bb.pdf/7432322e-2e45-3da1-c72b-f6f04fb0d027?t=1575020061567 (IPDJ 2012)
- https://ahresp.com/app/uploads/2024/07/PISCINAS-ET-.pdf (AHRESP 2024)
- https://cm-avis.pt/wp-content/uploads/2026/06/Normas_Piscinas-Municipais_2026_FINAL.pdf
- Failed: https://www.cm-penafiel.pt/wp-content/uploads/2016/09/DIRECTIVA_CNQ23-93-PiscinasPublicas.pdf (404); https://mariorebola.com/wp-content/uploads/DIRECTIVA_CNQ23_93.pdf (404); https://diariodarepublica.pt/dr/detalhe/despacho/2064-2021-158215165 (empty, JS-rendered); vlex.pt DR 5/97 (paywalled); https://www.arsnorte.min-saude.pt/.../PVSP_2018.pdf and PVSP_Piscinas_2022.pdf (returned an HTML page, not a PDF).
