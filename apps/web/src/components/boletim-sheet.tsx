import { cn } from '@/lib/utils';

/**
 * A club's boletim de sócio with words placed on it — POOLSE-142. One rule for
 * where a placement goes, shared by the editor and the print, so what the club
 * placed on screen is what comes out on paper:
 *
 * - **x and y are fractions of the page.** y is the text's baseline, so the
 *   word sits on the form's printed line whatever the size.
 * - **Size is in points of an A4 page**, drawn in container-query units: the
 *   sheet is a size container, 100cqw is the page's width (595.28 pt), and the
 *   same 11 pt is small in the editor and exactly 11 pt on paper.
 */
export const A4_WIDTH_PT = 595.28;

export function placementStyle(p: { x: number; y: number; sizePt: number }): React.CSSProperties {
  return {
    left: `${p.x * 100}%`,
    top: `${p.y * 100}%`,
    fontSize: `calc(${p.sizePt} / ${A4_WIDTH_PT} * 100cqw)`,
    // The box's bottom on the line: a descender may dip below it, as handwriting does.
    transform: 'translateY(-100%)',
    lineHeight: 1,
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
