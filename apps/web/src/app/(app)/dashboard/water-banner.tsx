/**
 * Water across the top of a card — the two onboarding screens (Rui, 10-11-2026).
 *
 * Decoration only, so it is `aria-hidden` and carries no words: whatever the
 * reader needs is in the heading and the card beneath. Each wave is drawn twice
 * as wide as the box and slides half its width, so the loop has no seam; the
 * movement is `.onboard-wave-*` in globals.css and stops under reduced motion.
 */
const WAVE =
  'M0 40 Q 180 14 360 40 T 720 40 T 1080 40 T 1440 40 T 1800 40 T 2160 40 T 2520 40 T 2880 40 V 120 H 0 Z';
const WAVE_LOW =
  'M0 52 Q 180 76 360 52 T 720 52 T 1080 52 T 1440 52 T 1800 52 T 2160 52 T 2520 52 T 2880 52 V 120 H 0 Z';

export function WaterBanner({
  children,
  tall = false,
}: {
  /** Drawn centred above the water — an icon or the welcome tick. */
  children?: React.ReactNode;
  tall?: boolean;
}): React.ReactElement {
  return (
    <div
      className={
        'relative flex items-center justify-center overflow-hidden bg-gradient-to-b from-primary/25 via-primary/10 to-transparent ' +
        (tall ? 'h-48' : 'h-28')
      }
    >
      <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-16">
        <svg
          className="onboard-wave onboard-wave-b absolute bottom-0 left-0 h-full w-[200%]"
          viewBox="0 0 2880 120"
          preserveAspectRatio="none"
        >
          <path d={WAVE} className="fill-primary/25" />
        </svg>
        <svg
          className="onboard-wave onboard-wave-a absolute bottom-0 left-0 h-[80%] w-[200%]"
          viewBox="0 0 2880 120"
          preserveAspectRatio="none"
        >
          <path d={WAVE_LOW} className="fill-complementary/40" />
        </svg>
        {/* The card's own colour last, so the body below rises out of the water. */}
        <svg
          className="onboard-wave onboard-wave-b absolute bottom-0 left-0 h-[45%] w-[200%]"
          viewBox="0 0 2880 120"
          preserveAspectRatio="none"
        >
          <path d={WAVE} className="fill-surface" />
        </svg>
      </div>
      {children !== undefined && <div className="relative">{children}</div>}
    </div>
  );
}
