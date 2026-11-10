import Link from 'next/link';
import { CheckPulse } from '@/components/check-pulse';

/**
 * "Já faz parte de …" — the arrival, said the way Início says it (Rui,
 * 10-11-2026): the tick and its ripples, the sentence, and the way in. Shared
 * by the moment of accepting and a later visit to the used link. `/app` routes
 * by role, so a family lands on its agenda and staff on the backoffice.
 */
export function Joined({ sentence, enter }: { sentence: string; enter: string }): React.ReactElement {
  return (
    <section className="flex flex-col items-center gap-5 rounded bg-surface px-5 py-8 text-center shadow-card">
      <CheckPulse size="medium" />
      <p className="onboard-rise text-lg font-semibold" style={{ '--i': 0 } as React.CSSProperties}>
        {sentence}
      </p>
      <Link
        href="/app"
        className="onboard-rise inline-flex h-control items-center justify-center rounded-sm bg-primary px-6 text-control font-semibold text-primary-foreground"
        style={{ '--i': 1 } as React.CSSProperties}
      >
        {enter}
      </Link>
    </section>
  );
}
