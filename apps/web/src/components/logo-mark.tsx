/**
 * Poolse's mark — POOLSE-139, from the design handoff: a 26 px square in the
 * primary fill with the initial in ink. Decorative: the word beside it, or the
 * link it sits in, carries the name for a screen reader.
 */
export function LogoMark(): React.ReactElement {
  return (
    <span
      aria-hidden
      className="inline-flex size-[26px] shrink-0 items-center justify-center rounded-sm bg-primary font-heading text-sm font-semibold text-primary-foreground"
    >
      P
    </span>
  );
}
