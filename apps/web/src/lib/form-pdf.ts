import { PDFDocument, StandardFonts, rgb, type PDFFont } from 'pdf-lib';
import { boletimValue, isTickField, type BoletimData, type BoletimPlacement } from '@poolse/rules';

/**
 * A club's form as a real PDF, for the phone — POOLSE-193 (Rui, 06-11-2026).
 *
 * The one exception to *a document on paper is a route with print styles*: a print
 * page gives a phone no file, and Chave Móvel Digital signs a PDF. The desktop
 * keeps its print pages. **Same inputs as `BoletimSheet`:** the club's image is the
 * page, `boletimValue` says what goes on each line, and a placement's fractions and
 * points mean what `placementStyle` makes them mean, so the two cannot drift on what
 * a form says. Portuguese whoever downloads it, as the print is.
 *
 * Pure, with no session and no fetch, so a test can read what it wrote. The PDF
 * carries nobody's name in its metadata, because a file on a phone gets shared.
 */

/** A4's width, as `placementStyle` counts its points. */
const PAGE_WIDTH_PT = 595.28;
/** Where a baseline sits above the box's bottom, as a share of the font's size. */
const BASELINE = 0.21;
/** The white strip around a value, in ems — `placementStyle`'s padding. */
const STRIP_ABOVE = 1.35;
const STRIP_BELOW = 0.3;

export interface FormPdfInput {
  image: Uint8Array;
  contentType: string;
  placements: readonly BoletimPlacement[];
  values: BoletimData;
  /** The club's day, `YYYY-MM-DD`. */
  today: string;
  title: string;
}

/** Helvetica has no glyph for some names: a `?` beats a form that will not build. */
function printable(text: string, font: PDFFont): string {
  const known = new Set(font.getCharacterSet());
  return [...text].map((char) => (known.has(char.codePointAt(0) as number) ? char : '?')).join('');
}

export async function formPdf(input: FormPdfInput): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(input.title);
  pdf.setProducer('Poolse');
  pdf.setCreator('Poolse');

  const image = input.contentType === 'image/png' ? await pdf.embedPng(input.image) : await pdf.embedJpg(input.image);
  const height = PAGE_WIDTH_PT * (image.height / image.width);
  const page = pdf.addPage([PAGE_WIDTH_PT, height]);
  page.drawImage(image, { x: 0, y: 0, width: PAGE_WIDTH_PT, height });
  const font = await pdf.embedFont(StandardFonts.Helvetica);

  for (const placement of input.placements) {
    const raw = boletimValue(placement.field, input.values, input.today);
    if (raw === null) continue;
    const text = printable(raw, font);
    const size = placement.sizePt;
    const x = placement.x * PAGE_WIDTH_PT;
    // A PDF counts up from the bottom of the page, the screen down from its top.
    const line = height - placement.y * height;

    if (isTickField(placement.field)) {
      const width = font.widthOfTextAtSize(text, size);
      page.drawText(text, { x: x - width / 2, y: line - size * 0.36, size, font, color: rgb(0, 0, 0) });
      continue;
    }
    if (placement.width !== null && placement.width !== undefined) {
      page.drawRectangle({
        x,
        y: line - size * STRIP_BELOW,
        width: placement.width * PAGE_WIDTH_PT,
        height: size * (STRIP_ABOVE + STRIP_BELOW),
        color: rgb(1, 1, 1),
      });
    }
    page.drawText(text, { x, y: line + size * BASELINE, size, font, color: rgb(0, 0, 0) });
  }
  return pdf.save();
}
