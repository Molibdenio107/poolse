import { isTickField, type BoletimField } from '@poolse/rules';
import { cn } from '@/lib/utils';

/**
 * A club's boletim de sócio with words placed on it — POOLSE-142. One rule for
 * where a placement goes, shared by the editor and the print, so what the club
 * placed on screen is what comes out on paper:
 *
 * - **x and y are fractions of the page.** y is the text's baseline (a tick box's centre), so the
 *   word sits on the form's printed line whatever the size.
 * - **Size is in points of an A4 page**, drawn in container-query units: the
 *   sheet is a size container, 100cqw is the page's width (595.28 pt), and the
 *   same 11 pt is small in the editor and exactly 11 pt on paper.
 */
export const A4_WIDTH_PT = 595.28;

export function placementStyle(p: {
  field: BoletimField;
  x: number;
  y: number;
  sizePt: number;
  width?: number | null | undefined;
}): React.CSSProperties {
  const base: React.CSSProperties = {
    left: `${p.x * 100}%`,
    top: `${p.y * 100}%`,
    fontSize: `calc(${p.sizePt} / ${A4_WIDTH_PT} * 100cqw)`,
    lineHeight: 1,
  };
  // A tick box's point is its centre, so its X is centred on it.
  if (isTickField(p.field)) return { ...base, transform: 'translate(-50%, -50%)' };
  // Text sits with its bottom on the line, a descender dipping below as handwriting does.
  if (p.width === null || p.width === undefined) return { ...base, transform: 'translateY(-100%)' };
  // With a strip (Rui, 01-11-2026): the value on a white band from x to where
  // the blank ends, a little above and below the text, which is where
  // handwriting spills — so nothing the scan has on that line shows through.
  // White is the paper's colour, not a theme's: the sheet is paper in both.
  return {
    ...base,
    width: `${p.width * 100}%`,
    paddingTop: '0.35em',
    paddingBottom: '0.3em',
    transform: 'translateY(calc(-100% + 0.3em))',
    background: 'white',
  };
}

/** The sheet: the form's image, full width, with whatever sits on it. */
export function BoletimSheet({
  imageUrl,
  alt,
  className,
  children,
}: {
  imageUrl: string;
  alt: string;
  className?: string | undefined;
  children?: React.ReactNode;
}): React.ReactElement {
  return (
    <div className={cn('relative [container-type:inline-size]', className)}>
      {/* eslint-disable-next-line @next/next/no-img-element -- streamed through /files/:id */}
      <img src={imageUrl} alt={alt} className="block w-full select-none" draggable={false} />
      {children}
    </div>
  );
}
