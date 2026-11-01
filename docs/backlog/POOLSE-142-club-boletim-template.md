# POOLSE-142 · A club uploads its own *boletim de sócio*, and each student's prints on it, filled in

> Part of the Poolse backlog. Conventions in [CONVENTIONS.md](./CONVENTIONS.md) apply to this ticket and are not repeated here.

**Type:** Feature · **Area:** Students / Club settings / Files / AI · **Priority:** High (pre go-live) · **Depends on** [POOLSE-134](./POOLSE-134-boletim-de-socio.md) (the boletim and its print route), [POOLSE-137](./POOLSE-137-ai-readers-per-club.md) (AI readers, for slice B)

### PO — why this exists

> "on 'Facilities' club details, we will add a place holder for a club to place a template for the membership document to be printed by each student … every club can have a custom template to be uploaded on club details." — Rui, 01-11-2026, with Ginásio Clube de Santo Tirso's *Proposta de Sócio* as the example

POOLSE-134 prints Poolse's own clean boletim. A club with a form of its own, one its direction has used for decades and files on paper, wants that form, filled in from the record.

Rui's calls (01-11-2026):
- **The AI places the fields**, and a person confirms them. The manual path stays (CLAUDE.md, AI readers), so the editor exists either way.
- **PDF or image.**
- **The SNS number may be placed**, printed for owner and admin only.

**Not in scope:**
- Ticking the form's own boxes (*Cobrança: na secretaria / por cobrador*).
- Several templates per club (one live template; replacing it is a new one).
- The student's photo in the *FOTO* box. This is a follow-up: it needs the photo-consent rule at print time.
- Changing Poolse's own boletim, which stays as the fallback.

### BA — rules

1. **One live template per club**, on *Dados do clube* (site page, owner and admin). The template belongs to the club, not the site, and the hint says so.
2. **The file is stored as an image.** A PDF's first page is rendered in the browser (pdf.js) to a JPEG at about 200 dpi before upload, so the editor, the print and the AI reader all read one image. One page only, and the screen says so.
3. **A placement** is a Poolse field, x and y as fractions of the page (0–1, the text's baseline start) and a size in pt (default 11). A field may be placed more than once, e.g. a locality used beside the date.
4. **The fields** are the boletim's data, plus split dates because paper forms write *__ de ____ de ____*. Name; the two parents' names; birth date, and its day, month in words and year; marital status, profession, education, birthplace, nationality; address, locality, postal code; phone, email; NIF; ID document number; SNS number; sócio number and *sócio desde*; the guardian's name, phone, email and relationship; today, and its day, month in words, year and the year's last two digits.
5. **The ID number and the SNS number are read only when the template places them.** The ID number's read is written to the audit log (`student.id_document_read`), as the Anexo 2's is. The boletim is owner and admin only, so the SNS rule holds.
6. **Replacing the template archives the old one and its placements**, because positions on another scan are meaningless. Removing it falls back to Poolse's boletim.
7. **Print:** the student's *Imprimir preenchido* uses the club's template when one is placed, else Poolse's. The other is one link away. The data prints in black; a blank prints nothing.
8. **Slice B: the AI proposes placements.** The reader is `boletim_template`, behind its /admin switch, the club's tick, the cap and `metered()`. It sends the image and the field list, nothing about any student, and returns positions loaded into the editor unsaved, for a person to adjust and save.

### Dev notes

- `file_purpose` gains `boletim_template` (write OFFICE, read OFFICE).
- `boletim_template` (one live per org by partial unique index) and `boletim_template_field` (field CHECK against the list, 0 ≤ x, y ≤ 1, 6 ≤ size ≤ 24 pt). Composite FKs, RLS, `TENANT_TABLES`.
- API: `GET/PUT/DELETE /settings/boletim-template` (`fileId`, `fields[]`); `/students/:id/boletim` carries the template, decrypting the ID number only when placed.
- Web: `BoletimTemplatePanel` on *Dados do clube*: upload (PDF → image), click to place a field, drag to move, × to remove, *Guardar*. The print route draws the image at A4 with absolutely placed text in pt.
- Most likely to be got wrong: positions in pixels (they must be page fractions, or a different render size moves everything); and the print scaling (`@page` A4 with no margin, image `width: 210mm`).

### QA

1. **Given** an owner on *Dados do clube*, **when** they upload the GCST PDF, **then** the page shows as an image and no field is placed.
2. **When** they place *Nome* on the *Nome* line and save, **then** a student's *Imprimir preenchido* shows the GCST form with the name on that line.
3. **Given** a template placing the ID number, **when** a boletim prints, **then** the number is printed and `student.id_document_read` is in the audit log; **given** one that does not place it, **then** no read is recorded.
4. **Given** an instructor, **then** `GET/PUT /settings/boletim-template` answer 403, and the role probe covers both.
5. **When** the template is replaced, **then** the old placements are gone and printing falls back to Poolse's boletim until fields are placed again.
6. A placement with x > 1, an unknown field or a size of 50 is refused with 400.
7. (Slice B) **Given** the reader off for the club, **then** *Propor posições* says so and the manual editor still works.

### Acceptance criteria

1. A club can upload a PDF or image boletim on *Dados do clube*, place Poolse's fields on it and save.
2. A student's boletim prints on the club's form with their data at those positions, in A4.
3. The ID and SNS numbers print only for owner and admin and only when placed; the ID read is audited.
4. Replacing or removing the template behaves per rules 6 and 7.
5. (Slice B) The AI proposes the positions, and nothing is saved until a person saves.
