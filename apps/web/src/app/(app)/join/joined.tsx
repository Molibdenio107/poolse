import Link from 'next/link';
import { LogoLockIn } from '@/components/logo-lock-in';
import { WaterBanner } from '../dashboard/water-banner';

/**
 * "Já faz parte de …" — the arrival, said the way Início says it (Rui,
 * 10-11-2026): the water, the Poolse mark as Início draws it (Rui, 17-11-2026: it
 * replaced the tick), the sentence, and the way in. Shared
 * by the moment of accepting and a later visit to the used link. `/app` routes
 * by role, so a family lands on its agenda and staff on the backoffice.
 */
export function Joined({ sentence, enter }: { sentence: string; enter: string }): React.ReactElement {
  return (
    <section className="overflow-hidden rounded bg-surface shadow-card">
      <WaterBanner tall>
        <LogoLockIn />
      </WaterBanner>
      <div className="flex flex-col items-center gap-5 px-5 pb-8 pt-2 text-center">
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
      </div>
    </section>
  );
}
