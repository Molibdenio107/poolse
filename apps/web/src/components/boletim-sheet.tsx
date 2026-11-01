import { DISCIPLINE_FIELDS, type BoletimField } from '@poolse/rules';
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

export function placementStyle(p: { field: BoletimField; x: number; y: number; sizePt: number }): React.CSSProperties {
  return {
    left: `${p.x * 100}%`,
    top: `${p.y * 100}%`,
    fontSize: `calc(${p.sizePt} / ${A4_WIDTH_PT} * 100cqw)`,
    // A tick box's point is its centre, so its X is centred on it; text sits
    // with its bottom on the line, a descender dipping below as handwriting does.
    transform: isTick(p.field) ? 'translate(-50%, -50%)' : 'translateY(-100%)',
    lineHeight: 1,
  };
}

function isTick(field: BoletimField): boolean {
  return (DISCIPLINE_FIELDS as readonly BoletimField[]).includes(field);
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
