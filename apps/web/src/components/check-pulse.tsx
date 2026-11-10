/**
 * The tick from Início (Rui, 10-11-2026): it pops, draws itself, and two
 * ripples go out from it, slowly and for as long as it is on screen. For the
 * moments that are an arrival — the club created, an invitation accepted.
 * A save's pulse is its quicker cousin in `components/ui/toast.tsx`.
 *
 * Decoration: the words beside it say what happened. The motion is CSS
 * (`.onboard-*` in globals.css) and none of it runs under reduced motion.
 */
export function CheckPulse({ size = 'large' }: { size?: 'large' | 'medium' }): React.ReactElement {
  const box = size === 'large' ? 'size-20' : 'size-16';
  return (
    <span aria-hidden className={`relative inline-flex ${box} items-center justify-center`}>
      <span className="onboard-ripple absolute inset-0 rounded-full border-2 border-primary" />
      <span className="onboard-ripple onboard-ripple-late absolute inset-0 rounded-full border-2 border-primary" />
      <span
        className={`onboard-check-circle inline-flex ${box} items-center justify-center rounded-full bg-primary text-primary-foreground shadow-card`}
      >
        <svg
          viewBox="0 0 24 24"
          className={size === 'large' ? 'size-10' : 'size-8'}
          fill="none"
          stroke="currentColor"
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path className="onboard-check-mark" d="M5 12.5l4.5 4.5L19 7.5" />
        </svg>
      </span>
    </span>
  );
}
