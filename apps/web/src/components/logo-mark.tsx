/**
 * Poolse's mark — the official icon (Rui, 14-11-2026), replacing POOLSE-139's
 * placeholder square. Decorative: the wordmark beside it, or the link it sits
 * in, carries the name for a screen reader.
 */
export function LogoMark(): React.ReactElement {
  // eslint-disable-next-line @next/next/no-img-element -- a static SVG, nothing to optimise
  return <img src="/brand/poolse-icon.svg" alt="" aria-hidden width={26} height={26} className="size-[26px] shrink-0" />;
}

/**
 * The wordmark, POOLSE in blue over its green shadow (Rui, 14-11-2026). It is
 * the name, so it carries it: `alt` is the product's name in the page's words.
 */
export function Wordmark({ alt, className }: { alt: string; className?: string }): React.ReactElement {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- a static SVG, nothing to optimise
    <img src="/brand/poolse-logo.svg" alt={alt} width={990} height={224} className={className ?? 'h-4 w-auto'} />
  );
}
